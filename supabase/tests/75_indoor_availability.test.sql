-- Hallenbelegung für die Online-Buchung: indoor_full (Kapazität, gleichzeitige Belegung, Status)
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

-- Halle mit genau 2 nutzbaren Plätzen (ein gesperrter zählt nicht); Zeitraum 2030 ohne Demo-Daten
update public.locations set active = false where area = 'hall';
update public.locations set active = true, status = 'free'
where id in (select id from public.locations where area = 'hall' order by code limit 2);
update public.locations set active = true, status = 'blocked'
where id = (select id from public.locations where area = 'hall' and not active order by code limit 1);

select pg_temp.assert_eq(public.indoor_full('2030-03-01 10:00+01', '2030-03-10 10:00+01'), false, 'leere Halle');

insert into public.bookings (customer_name, plate, start_at, end_at, parking_type, status) values
  ('A', 'M-A 1', '2030-03-01 08:00+01', '2030-03-05 08:00+01', 'indoor', 'booked'),
  ('B', 'M-B 1', '2030-03-06 08:00+01', '2030-03-12 08:00+01', 'indoor', 'booked'),
  -- zählt nicht: Außenplatz, storniert, abgeschlossen
  ('C', 'M-C 1', '2030-03-01 08:00+01', '2030-03-12 08:00+01', 'outdoor', 'booked'),
  ('D', 'M-D 1', '2030-03-01 08:00+01', '2030-03-12 08:00+01', 'indoor', 'cancelled'),
  ('E', 'M-E 1', '2030-03-01 08:00+01', '2030-03-12 08:00+01', 'indoor', 'completed');

-- A und B überschneiden sich nicht → höchstens 1 gleichzeitig, 2 Plätze
select pg_temp.assert_eq(public.indoor_full('2030-03-01 10:00+01', '2030-03-10 10:00+01'), false, 'nacheinander passt');

insert into public.bookings (customer_name, plate, start_at, end_at, parking_type, status) values
  ('F', 'M-F 1', '2030-03-04 08:00+01', '2030-03-08 08:00+01', 'indoor', 'stored');

-- F überschneidet sich am 04.03. mit A und am 06.03. mit B → 2 gleichzeitig = voll
select pg_temp.assert_eq(public.indoor_full('2030-03-01 10:00+01', '2030-03-10 10:00+01'), true, 'voll durch F');
select pg_temp.assert_eq(public.indoor_full('2030-03-05 09:00+01', '2030-03-06 07:00+01'), false, 'Lücke zwischen A und B');
select pg_temp.assert_eq(public.indoor_full('2030-03-12 08:00+01', '2030-03-20 08:00+01'), false, 'Abholung = Anreise ist frei');

-- Anonyme Besucher dürfen die Funktion nicht direkt aufrufen
select pg_temp.assert_eq(has_function_privilege('anon', 'public.indoor_full(timestamptz, timestamptz)', 'execute'), false, 'anon');
select pg_temp.assert_eq(has_function_privilege('service_role', 'public.indoor_full(timestamptz, timestamptz)', 'execute'), true, 'service_role');

rollback;
\o
\echo '  ✓ 75_indoor_availability'
