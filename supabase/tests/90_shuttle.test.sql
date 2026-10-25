-- Tests für die Shuttle-Dispo (plan_booking_transport, Slots, Umsetzen, Neuplanung)
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

-- Fahrt einer Buchung je Richtung: lokale Uhrzeit, Typ, Personen der Fahrt
create or replace function pg_temp.trip(p_booking uuid, p_dir text)
returns text language sql as $$
  select to_char(j.scheduled_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') || ' ' || j.type
  from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
  where p.booking_id = p_booking and j.direction = p_dir
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d7', 'shuttle@example.com');
update public.profiles set active = true, display_name = 'Fahrer Test' where id = '00000000-0000-0000-0000-0000000000d7';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d7';

-- Außen + Shuttle: Ankunft 10:00 → Hinfahrt 11:00 (10:15 aufgerundet), Landung 16:00 → Rückfahrt 17:00 (16:30 aufgerundet)
select (public.upsert_booking('{
  "external_ref": "SH01", "customer_name": "Erika Beispiel", "plate": "M-SH 101", "persons": 4,
  "start_at": "2030-10-21T10:00:00+02:00", "return_flight_at": "2030-10-24T16:00:00+02:00",
  "end_at": "2030-10-24T17:00:00+02:00", "parking_type": "outdoor", "return_mode": "shuttle"
}'::jsonb, 'test') ->> 'id') as b1 \gset
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'to_airport'), '2030-10-21 11:00 shuttle_slot', 'Hinfahrt Slot');
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'from_airport'), '2030-10-24 17:00 shuttle_slot', 'Rückfahrt Slot');

-- Zweite Buchung im selben Slot → gleiche Fahrt, Personen addiert
select (public.upsert_booking('{
  "external_ref": "SH02", "customer_name": "Max Muster", "plate": "M-SH 102", "persons": 5,
  "start_at": "2030-10-21T10:30:00+02:00", "end_at": "2030-10-25T12:00:00+02:00",
  "parking_type": "outdoor_cover", "return_mode": "shuttle"
}'::jsonb, 'test') ->> 'id') as b2 \gset
select pg_temp.assert_eq(
  (select count(*)::int from public.transport_jobs where type = 'shuttle_slot' and direction = 'to_airport'
     and scheduled_at = '2030-10-21T11:00:00+02:00'), 1, 'ein Slot');
select pg_temp.assert_eq(
  (select persons from public.transport_board('2030-10-21T00:00:00+02:00', '2030-10-22T00:00:00+02:00')
   where direction = 'to_airport'), 9, 'Personen im Slot');
select pg_temp.assert_eq(
  (select jsonb_array_length(passengers) from public.transport_board('2030-10-21T00:00:00+02:00', '2030-10-22T00:00:00+02:00')
   where direction = 'to_airport'), 2, 'zwei Fahrgäste');
-- Ohne Landezeit: Rückfahrt = Abholung − Puffer + 30 min = 11:30 → 12:00
select pg_temp.assert_eq(pg_temp.trip(:'b2', 'from_airport'), '2030-10-25 12:00 shuttle_slot', 'Rückfahrt ohne Landezeit');

-- Umbuchung: Ankunft 13:50 → 14:05 → Slot 15:00; leere Fahrten werden nicht gelöscht, solange B2 noch drin ist
select public.upsert_booking('{"external_ref": "SH01", "start_at": "2030-10-21T13:50:00+02:00"}'::jsonb, 'test') \gset
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'to_airport'), '2030-10-21 15:00 shuttle_slot', 'Umbuchung verschiebt');
select pg_temp.assert_eq(
  (select persons from public.transport_board('2030-10-21T11:00:00+02:00', '2030-10-21T11:01:00+02:00')), 5, 'alter Slot nur noch B2');

-- Personenzahl ändert sich mit
select public.upsert_booking('{"external_ref": "SH01", "persons": 2}'::jsonb, 'test') \gset
select pg_temp.assert_eq(
  (select persons::int from public.transport_passengers where booking_id = :'b1' limit 1), 2, 'Personen nachgezogen');

-- Storno B2 → aus allen Fahrten raus, leerer 11:00-Slot und 12:00-Slot werden aufgeräumt
select public.upsert_booking('{"external_ref": "SH02", "cancelled": true}'::jsonb, 'test') \gset
select pg_temp.assert_eq((select count(*)::int from public.transport_passengers where booking_id = :'b2'), 0, 'Storno entfernt');
select pg_temp.assert_eq(
  (select count(*)::int from public.transport_jobs where scheduled_at in ('2030-10-21T11:00:00+02:00', '2030-10-25T12:00:00+02:00')),
  0, 'leere Fahrten aufgeräumt');

-- Halle (Premium) → Auftrag auf Abruf zur genauen Uhrzeit
select (public.upsert_booking('{
  "external_ref": "SH03", "customer_name": "Premium Kunde", "plate": "M-SH 103", "persons": 1,
  "start_at": "2030-10-22T08:20:00+02:00", "return_flight_at": "2030-10-23T19:10:00+02:00",
  "end_at": "2030-10-23T20:10:00+02:00", "parking_type": "indoor", "return_mode": "shuttle"
}'::jsonb, 'test') ->> 'id') as b3 \gset
select pg_temp.assert_eq(pg_temp.trip(:'b3', 'to_airport'), '2030-10-22 08:35 premium_on_demand', 'Premium hin');
select pg_temp.assert_eq(pg_temp.trip(:'b3', 'from_airport'), '2030-10-23 19:40 premium_on_demand', 'Premium zurück');
-- Umbuchung verschiebt den eigenen Auftrag statt einen neuen anzulegen
select (select transport_job_id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
        where p.booking_id = :'b3' and j.direction = 'to_airport') as premium_job \gset
select public.upsert_booking('{"external_ref": "SH03", "start_at": "2030-10-22T09:00:00+02:00"}'::jsonb, 'test') \gset
select pg_temp.assert_eq(pg_temp.trip(:'b3', 'to_airport'), '2030-10-22 09:15 premium_on_demand', 'Premium umgebucht');
select pg_temp.assert_eq(
  (select transport_job_id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
   where p.booking_id = :'b3' and j.direction = 'to_airport'), :'premium_job'::uuid, 'gleicher Auftrag');

-- Landung spät nachts (außerhalb 05:00–23:00) → Auftrag auf Abruf
select (public.upsert_booking('{
  "external_ref": "SH04", "customer_name": "Nacht Flug", "plate": "M-SH 104",
  "start_at": "2030-10-21T06:40:00+02:00", "return_flight_at": "2030-10-24T22:50:00+02:00",
  "end_at": "2030-10-24T23:50:00+02:00", "parking_type": "outdoor", "return_mode": "shuttle"
}'::jsonb, 'test') ->> 'id') as b4 \gset
select pg_temp.assert_eq(pg_temp.trip(:'b4', 'to_airport'), '2030-10-21 07:00 shuttle_slot', 'früh im Slot');
select pg_temp.assert_eq(pg_temp.trip(:'b4', 'from_airport'), '2030-10-24 23:20 premium_on_demand', 'nachts auf Abruf');

-- Zeitumstellung (27.10.2030): Landung 12:00 MEZ → Slot 13:00 Ortszeit
select (public.upsert_booking('{
  "external_ref": "SH05", "customer_name": "Winter Zeit", "plate": "M-SH 105",
  "start_at": "2030-10-25T12:00:00+02:00", "return_flight_at": "2030-10-28T12:00:00+01:00",
  "end_at": "2030-10-28T13:00:00+01:00", "parking_type": "outdoor", "return_mode": "shuttle"
}'::jsonb, 'test') ->> 'id') as b5 \gset
select pg_temp.assert_eq(pg_temp.trip(:'b5', 'from_airport'), '2030-10-28 13:00 shuttle_slot', 'nach Zeitumstellung');

-- Hol- & Bringservice und Selbstabholer bekommen keine Shuttle-Fahrt
select public.upsert_booking('{"external_ref": "SH05", "return_mode": "self"}'::jsonb, 'test') \gset
select pg_temp.assert_eq((select count(*)::int from public.transport_passengers where booking_id = :'b5'), 0, 'self ohne Shuttle');

-- Dispo setzt B1 (Rückfahrt) von Hand in eine Fahrt auf Abruf um → Automatik lässt ihn dort
select p.id as p1 from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
where p.booking_id = :'b1' and j.direction = 'from_airport' \gset
select public.move_transport_passenger(:'p1', null, '2030-10-24T16:30:00+02:00') \gset
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'from_airport'), '2030-10-24 16:30 premium_on_demand', 'von Hand umgesetzt');
select pg_temp.assert_eq(
  (select count(*)::int from public.transport_jobs where scheduled_at = '2030-10-24T17:00:00+02:00'), 0, 'alter Slot leer und entfernt');
select public.upsert_booking('{"external_ref": "SH01", "return_flight_at": "2030-10-24T18:00:00+02:00", "end_at": "2030-10-24T19:00:00+02:00"}'::jsonb, 'test') \gset
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'from_airport'), '2030-10-24 16:30 premium_on_demand', 'manuell bleibt');
-- Umsetzung zurücknehmen → wieder automatisch (18:30 → 19:00)
select p.id as p1b from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
where p.booking_id = :'b1' and j.direction = 'from_airport' \gset
select public.reset_transport_passenger(:'p1b') \gset
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'from_airport'), '2030-10-24 19:00 shuttle_slot', 'Automatik zurück');

-- Umsetzen in andere Richtung wird abgelehnt
select j.id as hin_job from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
where p.booking_id = :'b1' and j.direction = 'to_airport' \gset
do $$
begin
  perform public.move_transport_passenger(
    (select p.id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
     where p.booking_id = (select id from public.bookings where external_ref = 'SH01') and j.direction = 'from_airport'),
    (select j.id from public.transport_passengers p join public.transport_jobs j on j.id = p.transport_job_id
     where p.booking_id = (select id from public.bookings where external_ref = 'SH01') and j.direction = 'to_airport'));
  raise exception 'FEHLER: Richtungswechsel hätte abgelehnt werden müssen';
exception when sqlstate '22023' then null;
end $$;

-- Laufende Fahrt wird nicht mehr umgeplant
update public.transport_jobs set status = 'underway' where id = :'hin_job';
select public.upsert_booking('{"external_ref": "SH01", "start_at": "2030-10-21T07:00:00+02:00"}'::jsonb, 'test') \gset
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'to_airport'), '2030-10-21 15:00 shuttle_slot', 'unterwegs bleibt');
update public.transport_jobs set status = 'planned' where id = :'hin_job';

-- Einstellungen ändern (Takt 30 min, als Admin) → alles neu geplant: 07:00 + 15 = 07:15 → 07:30
reset role;
update public.settings set value = '30' where key = 'shuttle_interval_minutes';
set role authenticated;
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'to_airport'), '2030-10-21 07:30 shuttle_slot', 'Takt 30 min');
reset role;
update public.settings set value = '60' where key = 'shuttle_interval_minutes';
set role authenticated;
select pg_temp.assert_eq(pg_temp.trip(:'b1', 'to_airport'), '2030-10-21 08:00 shuttle_slot', 'Takt zurück');

-- Fahrerliste und Fahrten der Buchung
select pg_temp.assert_eq((select count(*)::int from public.list_drivers() where display_name = 'Fahrer Test'), 1, 'Fahrerliste');
select pg_temp.assert_eq((select count(*)::int from public.booking_transport(:'b1')), 2, 'Fahrten im Detail');

-- Ohne Profil kein Zugriff
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select pg_temp.assert_eq((select count(*)::int from public.transport_board('2030-01-01', '2031-01-01')), 0, 'fremd sieht nichts');

reset role;
\o
\echo '  ✓ 90_shuttle'
