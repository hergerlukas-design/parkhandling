-- Kapazität je Bereich (area_full) und Preismodell der Website (base_price / extra_day_price)
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

begin;

-- Preise und Name aus der Migration
select pg_temp.assert_eq((select base_price::text || '/' || extra_day_price::text from public.booking_tariffs where code = 'economy'), '49.00/7.50', 'Economy');
select pg_temp.assert_eq((select base_price::text || '/' || extra_day_price::text from public.booking_tariffs where code = 'space'), '59.00/9.00', 'CarCover');
select pg_temp.assert_eq((select base_price::text || '/' || extra_day_price::text from public.booking_tariffs where code = 'business'), '89.00/12.50', 'Business');
select pg_temp.assert_eq((select base_price::text || '/' || extra_day_price::text from public.booking_tariffs where code = 'premium'), '98.00/14.00', 'Premium');
select pg_temp.assert_eq((select label from public.booking_tariffs where code = 'space'), 'CarCover', 'Name CarCover');

-- Je Außenbereich genau 1 nutzbarer Platz, ein gesperrter zählt nicht; Zeitraum 2030 ohne Demo-Daten
update public.locations set active = false where area in ('outdoor_a', 'outdoor_b');
update public.locations set active = true, status = 'free'
where id in (
  (select id from public.locations where area = 'outdoor_a' order by code limit 1),
  (select id from public.locations where area = 'outdoor_b' order by code limit 1)
);
update public.locations set active = true, status = 'blocked'
where id = (select id from public.locations where area = 'outdoor_b' and not active order by code limit 1);

select pg_temp.assert_eq(public.area_full('2030-03-01 10:00+01', '2030-03-10 10:00+01', 'outdoor_cover'), false, 'Außen A leer');
select pg_temp.assert_eq(public.area_full('2030-03-01 10:00+01', '2030-03-10 10:00+01', 'outdoor'), false, 'Außen B leer');

insert into public.bookings (customer_name, plate, start_at, end_at, parking_type, status) values
  ('A', 'M-A 1', '2030-03-03 08:00+01', '2030-03-08 08:00+01', 'outdoor', 'booked'),
  -- zählt nicht: storniert, abgeschlossen
  ('B', 'M-B 1', '2030-03-01 08:00+01', '2030-03-12 08:00+01', 'outdoor_cover', 'cancelled'),
  ('C', 'M-C 1', '2030-03-01 08:00+01', '2030-03-12 08:00+01', 'outdoor_cover', 'completed');

select pg_temp.assert_eq(public.area_full('2030-03-01 10:00+01', '2030-03-10 10:00+01', 'outdoor'), true, 'Außen B voll');
select pg_temp.assert_eq(public.area_full('2030-03-01 10:00+01', '2030-03-10 10:00+01', 'outdoor_cover'), false, 'Außen A bleibt frei');
select pg_temp.assert_eq(public.area_full('2030-03-08 08:00+01', '2030-03-15 08:00+01', 'outdoor'), false, 'Abholung = Anreise ist frei');

-- Halle: gleiches Ergebnis wie indoor_full
select pg_temp.assert_eq(
  public.area_full('2030-03-01 10:00+01', '2030-03-10 10:00+01', 'indoor'),
  public.indoor_full('2030-03-01 10:00+01', '2030-03-10 10:00+01'), 'indoor wie indoor_full');

-- Unbekannter Bereich: keine Plätze → voll
select pg_temp.assert_eq(public.area_full('2030-03-01 10:00+01', '2030-03-10 10:00+01', 'unbekannt'), true, 'unbekannt');

-- Website-Buchung: Quelle „website“, PF-Nummer als external_ref, Leistung Laden → Aufgabe
with b as (
  insert into public.bookings (id, source, external_ref, customer_name, plate, start_at, end_at, parking_type, tariff_code, payment_status, price_total)
  values ('1a2b3c4d-0000-4000-8000-000000000001', 'website', 'PF-1A2B3C4D', 'W', 'M-W 1', '2030-04-01 08:00+02', '2030-04-08 08:00+02', 'outdoor', 'economy', 'open', 64.00)
  returning id
)
insert into public.booking_services (booking_id, service_id, description)
select b.id, s.id, 'Ladeziel: 80 %' from b, public.services s where s.code = 'LADEN';
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks where booking_id = '1a2b3c4d-0000-4000-8000-000000000001' and type = 'charge'), 1, 'Aufgabe Laden');

-- Zahlung erhalten (App: upsert_booking mit id + payment_status): Statuswechsel steht im Verlauf, sonst bleibt alles
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b7', 'kasse@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000b7';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b7';
select public.upsert_booking('{"id": "1a2b3c4d-0000-4000-8000-000000000001", "payment_status": "paid"}'::jsonb, 'manual');
select pg_temp.assert_eq((select payment_status || '/' || source || '/' || external_ref || '/' || status || '/' || price_total::text from public.bookings where id = '1a2b3c4d-0000-4000-8000-000000000001'), 'paid/website/PF-1A2B3C4D/booked/64.00', 'Zahlung erhalten');
reset role;
select pg_temp.assert_eq(
  (select count(*)::int from public.booking_history
   where booking_id = '1a2b3c4d-0000-4000-8000-000000000001' and changed_fields ? 'payment_status'
     and changed_by = '00000000-0000-0000-0000-0000000000b7'), 1, 'Verlauf Zahlung');

-- Anonyme Besucher dürfen die Funktion nicht direkt aufrufen
select pg_temp.assert_eq(has_function_privilege('anon', 'public.area_full(timestamptz, timestamptz, text)', 'execute'), false, 'anon');
select pg_temp.assert_eq(has_function_privilege('service_role', 'public.area_full(timestamptz, timestamptz, text)', 'execute'), true, 'service_role');

rollback;
\o
\echo '  ✓ 77_area_full'
