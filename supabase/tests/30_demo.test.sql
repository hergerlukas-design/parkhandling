-- Demo-Daten: Plausibilität (läuft als Superuser, nach den anderen Tests)
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

\ir ../demo.sql
-- zweimal ausführbar (idempotent)
\ir ../demo.sql

select pg_temp.assert_eq((select count(*)::int from public.bookings where source = 'demo'), 40, '40 Demo-Buchungen');
select pg_temp.assert_eq((select count(*)::int from public.bookings where source = 'demo' and current_location_id is not null),
  35, '35 eingelagert');
select pg_temp.assert_eq((select count(*)::int from public.bookings where source = 'demo'
  and end_at > now() + interval '15 days'), 0, 'Abholungen innerhalb von 14 Tagen');
select pg_temp.assert_eq((select count(*)::int from public.bookings where source = 'demo' and fuel_type = 'electric') > 0,
  true, 'E-Fahrzeuge vorhanden');
select pg_temp.assert_eq((select count(distinct parking_type)::int from public.bookings where source = 'demo'), 3,
  'Indoor, Außen mit und ohne Plane');
select pg_temp.assert_eq((select count(*)::int from public.bookings where source = 'demo' and status = 'ready') > 0,
  true, 'einige Fahrzeuge bereit');
-- Kennzeichenformat M-AB 1234
select pg_temp.assert_eq((select count(*)::int from public.bookings where source = 'demo'
  and plate !~ '^M-[A-Z]{2} [0-9]{4}$'), 0, 'Kennzeichenformat');
-- Keine Überbelegung
select pg_temp.assert_eq((select count(*)::int from public.locations l
  where public.location_occupancy(l.id) > l.capacity), 0, 'keine Überbelegung');
-- Halle: korrekte Spalten sortiert, R6 bewusst falsch
select pg_temp.assert_eq((
  select count(*)::int from public.locations lo
  join public.bookings bl on bl.current_location_id = lo.id
  join public.locations hi on hi.area = 'hall' and hi.rack = lo.rack and hi.level = lo.level + 1
  join public.bookings bh on bh.current_location_id = hi.id
  where lo.area = 'hall' and bl.end_at > bh.end_at), 1, 'genau ein Reihenfolge-Konflikt (R6)');
select pg_temp.assert_eq((select status from public.locations where code = 'R6-E3'), 'blocked',
  'R6-E3 nur mit Umsetzen');
select pg_temp.assert_eq((select count(*)::int from public.locations where code like 'R7-%' and status = 'free'), 3,
  'R7 frei');

-- Listen-View: Filterzahlen und Chips
select pg_temp.assert_eq((select count(*)::int from public.booking_list where source = 'demo'), 40, 'View liefert alle Buchungen');
select pg_temp.assert_eq((select count(*)::int from public.booking_list where source = 'demo' and open_charge_fuel_count > 0) > 0,
  true, 'Laden/Tanken offen vorhanden');
select pg_temp.assert_eq((select jsonb_array_length(task_chips) from public.booking_list where external_ref = 'DEMO-0012') >= 1,
  true, 'Leistungs-Chips vorhanden');
select pg_temp.assert_eq((select task_chips -> 0 ->> 'title' from public.booking_list where external_ref = 'DEMO-0012'),
  'Grundreinigung', 'Grundreinigung zuerst');

\o
\echo '  ✓ 30_demo'
