-- Tests für Grundschema und Trigger. Läuft mit scripts/db-test.sh gegen eine Wegwerf-DB.
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

-- ---------------------------------------------------------------------------
-- 1. Buchung anlegen → Grundreinigung + Aufgabe
-- ---------------------------------------------------------------------------
insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type)
values ('manual', 'T-1', 'Erika Muster', 'M-AB 123', now() + interval '1 day', now() + interval '8 days', 'indoor')
returning id as b1 \gset

select pg_temp.assert_eq(
  (select count(*)::int from public.booking_services bs join public.services s on s.id = bs.service_id
   where bs.booking_id = :'b1' and s.code = 'GRUND'), 1, 'Grundreinigung automatisch gebucht');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks where booking_id = :'b1' and type = 'service' and status = 'open'),
  1, 'Aufgabe für Grundreinigung');
select pg_temp.assert_eq(
  (select plate_normalized from public.bookings where id = :'b1'), 'MAB123', 'Kennzeichen normalisiert');
select pg_temp.assert_eq(
  (select count(*)::int from public.booking_history where booking_id = :'b1'), 0,
  'Anlage erzeugt keinen Historieneintrag');

-- Idempotenz-Schlüssel (source, external_ref)
do $$
begin
  insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type)
  values ('manual', 'T-1', 'Doppelt', 'X', now(), now() + interval '1 day', 'outdoor');
  raise exception 'FEHLER: doppelte external_ref wurde akzeptiert';
exception when unique_violation then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Leistungen nachbuchen → Aufgaben mit passendem Typ + Historie
-- ---------------------------------------------------------------------------
insert into public.booking_services (booking_id, service_id, price_at_booking)
select :'b1', id, price from public.services where code in ('INNEN', 'LADEN');

select pg_temp.assert_eq(
  (select count(*)::int from public.tasks where booking_id = :'b1' and status = 'open'), 3, 'drei offene Aufgaben');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks where booking_id = :'b1' and type = 'charge'), 1, 'Ladeaufgabe vom Typ charge');
select pg_temp.assert_eq(
  (select count(*)::int from public.booking_history where booking_id = :'b1' and changed_fields ? 'service_added'),
  2, 'Nachbuchungen in Historie');

-- ---------------------------------------------------------------------------
-- 3. Bewegungen → aktueller Ort, Ortsstatus, Hallen-Sperrlogik
-- ---------------------------------------------------------------------------
select id as r1e1 from public.locations where code = 'R1-E1' \gset
select id as r1e2 from public.locations where code = 'R1-E2' \gset
select id as r1e3 from public.locations where code = 'R1-E3' \gset
select id as work from public.locations where code = 'W-AUF' \gset

update public.bookings set status = 'arrived' where id = :'b1';
insert into public.vehicle_movements (booking_id, to_location_id, reason) values (:'b1', :'work', 'Aufbereitung');
select pg_temp.assert_eq((select current_location_id from public.bookings where id = :'b1'), :'work'::uuid,
  'aktueller Ort = Aufbereitung');
select pg_temp.assert_eq((select status from public.locations where id = :'work'), 'free',
  'Arbeitsplatz mit Kapazität 4 bleibt frei');

insert into public.vehicle_movements (booking_id, to_location_id, reason) values (:'b1', :'r1e1', 'Einlagern');
select pg_temp.assert_eq((select from_location_id from public.vehicle_movements where booking_id = :'b1' and to_location_id = :'r1e1'),
  :'work'::uuid, 'from_location_id automatisch gesetzt');
select pg_temp.assert_eq((select status from public.locations where id = :'r1e1'), 'occupied', 'R1-E1 belegt');
select pg_temp.assert_eq((select status from public.locations where id = :'r1e2'), 'blocked', 'R1-E2 nur mit Umsetzen');
select pg_temp.assert_eq((select status from public.locations where id = :'r1e3'), 'blocked', 'R1-E3 nur mit Umsetzen');

-- Nachträglich erfasste (ältere) Bewegung überschreibt den aktuellen Ort nicht
insert into public.vehicle_movements (booking_id, to_location_id, moved_at, reason)
values (:'b1', :'work', now() - interval '1 hour', 'Nachtrag');
select pg_temp.assert_eq((select current_location_id from public.bookings where id = :'b1'), :'r1e1'::uuid,
  'ältere Bewegung ändert aktuellen Ort nicht');

-- ---------------------------------------------------------------------------
-- 4. Aufgaben → Status-Flow
-- ---------------------------------------------------------------------------
update public.bookings set status = 'stored' where id = :'b1';
update public.tasks set status = 'in_progress' where booking_id = :'b1' and type = 'charge';
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'in_service', 'in Arbeit → in_service');

update public.tasks set status = 'done' where booking_id = :'b1';
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'ready', 'alle erledigt → ready');
select pg_temp.assert_eq((select count(*)::int from public.tasks where booking_id = :'b1' and done_at is null), 0,
  'done_at gesetzt');

-- Umbuchung: neue Leistung → wieder eingelagert (Fahrzeug steht in der Halle)
insert into public.booking_services (booking_id, service_id, price_at_booking)
select :'b1', id, price from public.services where code = 'AUSSEN';
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'stored', 'neue Leistung → stored');

-- Storno einer Leistung → Aufgabe storniert (nicht gelöscht) → wieder ready
update public.booking_services set status = 'cancelled'
where booking_id = :'b1' and service_id = (select id from public.services where code = 'AUSSEN');
select pg_temp.assert_eq(
  (select status from public.tasks t join public.services s on s.id = t.service_id
   where t.booking_id = :'b1' and s.code = 'AUSSEN'), 'cancelled', 'Aufgabe storniert');
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'ready', 'nach Storno wieder ready');
select pg_temp.assert_eq(
  (select cancelled_at is not null from public.booking_services bs join public.services s on s.id = bs.service_id
   where bs.booking_id = :'b1' and s.code = 'AUSSEN'), true, 'cancelled_at gesetzt');

-- Umsetz-Aufgaben zählen nicht für "bereit"
insert into public.tasks (booking_id, type, title) values (:'b1', 'relocate', 'Umsetzen');
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'ready', 'relocate ignoriert');

-- ---------------------------------------------------------------------------
-- 5. Umbuchung end_at → Historie + Fälligkeit verschoben
-- ---------------------------------------------------------------------------
insert into public.booking_services (booking_id, service_id, price_at_booking)
select :'b1', id, price from public.services where code = 'REIFEN';
select extract(epoch from due_at)::bigint as due_before from public.tasks t
  join public.services s on s.id = t.service_id where t.booking_id = :'b1' and s.code = 'REIFEN' \gset

set app.change_source = 'csv_import';
update public.bookings set end_at = end_at + interval '2 days' where id = :'b1';
reset app.change_source;

select pg_temp.assert_eq(
  (select extract(epoch from due_at)::bigint from public.tasks t join public.services s on s.id = t.service_id
   where t.booking_id = :'b1' and s.code = 'REIFEN'), (:due_before + 2 * 86400)::bigint, 'Fälligkeit verschoben');
select pg_temp.assert_eq(
  (select source from public.booking_history where booking_id = :'b1' and changed_fields ? 'end_at'),
  'csv_import', 'Historie mit Quelle');

-- ---------------------------------------------------------------------------
-- 6. Auslagern → Plätze wieder frei
-- ---------------------------------------------------------------------------
insert into public.vehicle_movements (booking_id, to_location_id, reason) values (:'b1', null, 'Übergabe');
update public.bookings set status = 'completed' where id = :'b1';
select pg_temp.assert_eq((select status from public.locations where id = :'r1e1'), 'free', 'R1-E1 frei');
select pg_temp.assert_eq((select status from public.locations where id = :'r1e3'), 'free', 'R1-E3 frei');

-- ---------------------------------------------------------------------------
-- 7. RLS: nur freigeschaltetes Personal
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'neu@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'staff@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-000000000002';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.assert_eq((select count(*)::int from public.bookings), 0, 'inaktives Konto sieht nichts');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select pg_temp.assert_eq((select count(*)::int from public.bookings), 1, 'Personal sieht Buchungen');
do $$
begin
  update public.settings set value = '1' where key = 'shuttle_interval_minutes';
  if found then
    raise exception 'FEHLER: Personal darf Einstellungen nicht ändern';
  end if;
end;
$$;
do $$
begin
  insert into public.booking_history (booking_id, changed_fields) select id, '{}' from public.bookings limit 1;
  raise exception 'FEHLER: Historie ist direkt beschreibbar';
exception when insufficient_privilege then null;
end;
$$;
-- Trigger laufen auch nach Entzug von EXECUTE (Härtung) für Personal
insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type)
values ('manual', 'T-RLS', 'Personal-Test', 'B-XY 1', now(), now() + interval '2 days', 'outdoor');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks t join public.bookings b on b.id = t.booking_id where b.external_ref = 'T-RLS'),
  1, 'Trigger erzeugen Aufgabe auch als authenticated');
do $$
begin
  perform public.log_booking_change(gen_random_uuid(), '{}');
  raise exception 'FEHLER: interne Funktion per RPC aufrufbar';
exception when insufficient_privilege then null;
end;
$$;
reset role;
reset request.jwt.claim.sub;

\o
\echo '  ✓ 10_core_logic'
