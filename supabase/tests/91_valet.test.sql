-- Tests für den Hol- & Bringservice (Übergabe am Terminal)
\set ON_ERROR_STOP 1
\o /dev/null

create or replace function pg_temp.assert_eq(actual anyelement, expected anyelement, msg text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FEHLER: % (erwartet %, erhalten %)', msg, expected, actual;
  end if;
end;
$$;

create or replace function pg_temp.trip(p_booking uuid, p_dir text)
returns text language sql as $$
  select to_char(j.scheduled_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') || ' ' || j.type
  from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
  where p.booking_id = p_booking and j.direction = p_dir
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d8', 'valet@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000d8';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d8';

select pg_temp.assert_eq((select value from public.settings where key = 'valet_return_after_landing_minutes'), '30'::jsonb, 'Einstellung');

-- Übernahme am Terminal zur Ankunftszeit, Rückgabe Landung + 30 min, je eigener Auftrag
select (public.upsert_booking('{
  "external_ref": "VA01", "customer_name": "Valet Kunde", "plate": "M-VA 101", "persons": 2,
  "start_at": "2031-03-10T07:40:00+01:00", "return_flight_at": "2031-03-14T16:05:00+01:00",
  "end_at": "2031-03-14T17:05:00+01:00", "parking_type": "outdoor", "return_mode": "pickup_delivery"
}'::jsonb, 'test') ->> 'id') as v1 \gset
select pg_temp.assert_eq(pg_temp.trip(:'v1', 'from_airport'), '2031-03-10 07:40 pickup_delivery', 'Übernahme');
select pg_temp.assert_eq(pg_temp.trip(:'v1', 'to_airport'), '2031-03-14 16:35 pickup_delivery', 'Rückgabe');

-- Zweites Fahrzeug zur gleichen Zeit → eigener Auftrag (kein Sammel-Slot)
select (public.upsert_booking('{
  "external_ref": "VA02", "customer_name": "Valet Zwei", "plate": "M-VA 102",
  "start_at": "2031-03-10T07:40:00+01:00", "end_at": "2031-03-12T12:00:00+01:00",
  "parking_type": "indoor", "return_mode": "pickup_delivery"
}'::jsonb, 'test') ->> 'id') as v2 \gset
select pg_temp.assert_eq(
  (select count(*)::int from public.transport_jobs where type = 'pickup_delivery' and direction = 'from_airport'
     and scheduled_at = '2031-03-10T07:40:00+01:00'), 2, 'je Fahrzeug ein Auftrag');
-- ohne Landezeit: Abholung − 60 + 30 = 11:30
select pg_temp.assert_eq(pg_temp.trip(:'v2', 'to_airport'), '2031-03-12 11:30 pickup_delivery', 'Rückgabe ohne Landung');

-- Umbuchung verschiebt den eigenen Auftrag
select (select p.transport_job_id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
        where p.booking_id = :'v1' and j.direction = 'from_airport') as job1 \gset
select public.upsert_booking('{"external_ref": "VA01", "start_at": "2031-03-10T09:15:00+01:00"}'::jsonb, 'test') \gset
select pg_temp.assert_eq(pg_temp.trip(:'v1', 'from_airport'), '2031-03-10 09:15 pickup_delivery', 'Umbuchung');
select pg_temp.assert_eq(
  (select p.transport_job_id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
   where p.booking_id = :'v1' and j.direction = 'from_airport'), :'job1'::uuid, 'gleicher Auftrag');

-- Uhrzeit von Hand ändern → bleibt bei Umbuchung, Automatik zurück → wieder berechnet
select p.id as vp from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
where p.booking_id = :'v1' and j.direction = 'to_airport' \gset
select public.move_transport_passenger(:'vp', null, '2031-03-14T16:50:00+01:00') \gset
select pg_temp.assert_eq(pg_temp.trip(:'v1', 'to_airport'), '2031-03-14 16:50 pickup_delivery', 'Zeit von Hand');
select public.upsert_booking('{"external_ref": "VA01", "return_flight_at": "2031-03-14T17:00:00+01:00", "end_at": "2031-03-14T18:00:00+01:00"}'::jsonb, 'test') \gset
select pg_temp.assert_eq(pg_temp.trip(:'v1', 'to_airport'), '2031-03-14 16:50 pickup_delivery', 'von Hand bleibt');
select public.reset_transport_passenger(:'vp') \gset
select pg_temp.assert_eq(pg_temp.trip(:'v1', 'to_airport'), '2031-03-14 17:30 pickup_delivery', 'Automatik zurück');

-- Mischen mit Shuttle wird abgelehnt
select (public.upsert_booking('{
  "external_ref": "VA03", "customer_name": "Shuttle Gast", "plate": "M-VA 103",
  "start_at": "2031-03-10T09:00:00+01:00", "end_at": "2031-03-15T12:00:00+01:00",
  "parking_type": "outdoor", "return_mode": "shuttle"
}'::jsonb, 'test') ->> 'id') as v3 \gset
do $$
begin
  perform public.move_transport_passenger(
    (select p.id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
     where p.booking_id = (select id from public.bookings where external_ref = 'VA01') and j.direction = 'to_airport'),
    (select j.id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
     where p.booking_id = (select id from public.bookings where external_ref = 'VA03') and j.direction = 'to_airport'));
  raise exception 'FEHLER: Mischen hätte abgelehnt werden müssen';
exception when sqlstate '22023' then null;
end $$;

-- Wechsel Hol- & Bring → Shuttle: Aufträge weg, Shuttle-Slots da
select public.upsert_booking('{"external_ref": "VA02", "return_mode": "shuttle"}'::jsonb, 'test') \gset
select pg_temp.assert_eq(pg_temp.trip(:'v2', 'from_airport'), '2031-03-12 11:30 premium_on_demand', 'Halle → auf Abruf');
select pg_temp.assert_eq(pg_temp.trip(:'v2', 'to_airport'), '2031-03-10 07:55 premium_on_demand', 'Halle hin auf Abruf');
select pg_temp.assert_eq(
  (select count(*)::int from public.transport_jobs where type = 'pickup_delivery' and direction = 'from_airport'
     and scheduled_at = '2031-03-10T07:40:00+01:00'), 0, 'alter Hol- & Bring-Auftrag entfernt');

-- Storno räumt auf
select public.upsert_booking('{"external_ref": "VA01", "cancelled": true}'::jsonb, 'test') \gset
select pg_temp.assert_eq((select count(*)::int from public.transport_passengers where booking_id = :'v1'), 0, 'Storno');

-- Terminal aus der Flugnummer
select pg_temp.assert_eq(public.terminal_for_flight('LH2066'), 'T2', 'Lufthansa T2');
select pg_temp.assert_eq(public.terminal_for_flight('lx 1111'), 'T2', 'SWISS T2, Leerzeichen');
select pg_temp.assert_eq(public.terminal_for_flight('TK1630'), 'T1', 'sonst T1');
select pg_temp.assert_eq(public.terminal_for_flight('4U123'), 'T1', 'Code mit Ziffer');
select pg_temp.assert_eq(public.terminal_for_flight(null), null::text, 'ohne Flug');

-- Fahrer-Shuttle: Übernahme 09:30 → letzter Shuttle, der bis 09:30 am Terminal ist (09:00 + 16 min)
select (public.upsert_booking('{
  "external_ref": "VA04", "customer_name": "Terminal Gast", "plate": "M-VA 104",
  "start_at": "2031-03-11T09:30:00+01:00", "return_flight_at": "2031-03-13T14:10:00+01:00",
  "end_at": "2031-03-13T15:10:00+01:00", "flight_out": "LH2066", "flight_return": "TK1631",
  "parking_type": "outdoor", "return_mode": "pickup_delivery"
}'::jsonb, 'test') ->> 'id') as v4 \gset
select pg_temp.assert_eq(
  (select to_char(driver_shuttle_at at time zone 'Europe/Berlin', 'HH24:MI')
   from public.transport_board('2031-03-11T00:00:00+01:00', '2031-03-12T00:00:00+01:00') where type = 'pickup_delivery'),
  '09:00', 'Fahrer hin mit Shuttle 09:00');
select pg_temp.assert_eq(
  (select passengers -> 0 ->> 'terminal'
   from public.transport_board('2031-03-11T00:00:00+01:00', '2031-03-12T00:00:00+01:00') where type = 'pickup_delivery'),
  'T2', 'Übernahme am Abflug-Terminal (LH)');
-- Rückgabe 14:40 (+15 Übergabe) → nächster Shuttle zurück 15:00, Terminal aus Rückflug (TK → T1)
select pg_temp.assert_eq(
  (select to_char(scheduled_at at time zone 'Europe/Berlin', 'HH24:MI') || ' ' || to_char(driver_shuttle_at at time zone 'Europe/Berlin', 'HH24:MI') || ' ' || (passengers -> 0 ->> 'terminal')
   from public.transport_board('2031-03-13T00:00:00+01:00', '2031-03-14T00:00:00+01:00') where type = 'pickup_delivery'),
  '14:40 15:00 T1', 'Rückgabe, Fahrer zurück, Terminal');
-- Shuttle-Fahrgast bekommt ebenfalls sein Terminal
select pg_temp.assert_eq(
  (select passengers -> 0 ->> 'flight'
   from public.transport_board('2031-03-10T00:00:00+01:00', '2031-03-11T00:00:00+01:00')
   where type = 'shuttle_slot' and direction = 'to_airport' limit 1) is null, true, 'Shuttle ohne Flug: kein Flug');

reset role;
\o
\echo '  ✓ 91_valet'
