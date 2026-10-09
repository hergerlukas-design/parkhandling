-- Regal-Logik Halle (Abschnitt 5) und Ein-/Auschecken – läuft nach den Demo-Daten (R1–R6 belegt, R7/R8 frei)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'regal@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000c1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

-- Demo-Spalte R6 (bewusst falsch sortiert) hat automatisch eine Umsetz-Aufgabe
select pg_temp.assert_eq((select count(*)::int from public.tasks t join public.bookings b on b.id = t.booking_id
  join public.locations l on l.id = b.current_location_id
  where t.type = 'relocate' and t.status = 'open' and l.code = 'R6-E1'), 1, 'Umsetz-Aufgabe für R6');
select pg_temp.assert_eq((select t.note like '%Schlüssel mitnehmen: Fach R6-E1 → Fach des neuen Stellplatzes.' from public.tasks t
  join public.bookings b on b.id = t.booking_id join public.locations l on l.id = b.current_location_id
  where t.type = 'relocate' and t.status = 'open' and l.code = 'R6-E1'), true, 'Umsetz-Aufgabe nennt das Schlüsselfach');

-- Testfahrzeuge mit Abholung in 2, 4, 6 und 8 Tagen
select count(*) from (
  select public.upsert_booking(jsonb_build_object('external_ref', 'H-' || d, 'customer_name', 'Regal ' || d,
    'plate', 'M-RT ' || d, 'start_at', now(), 'end_at', now() + make_interval(days => d),
    'parking_type', 'indoor'), 'regaltest')
  from (values (2), (4), (6), (8)) v(d)
) x;
select id as b2 from public.bookings where external_ref = 'H-2' \gset
select id as b4 from public.bookings where external_ref = 'H-4' \gset
select id as b6 from public.bookings where external_ref = 'H-6' \gset
select id as b8 from public.bookings where external_ref = 'H-8' \gset

-- ---------------------------------------------------------------------------
-- 1. Leere Spalte: Vorschlag ist eine leere Spalte ganz oben, keine Konflikte
-- ---------------------------------------------------------------------------
select pg_temp.assert_eq((select count(*)::int from public.check_column(7, 1)), 0, 'leere Spalte ohne Konflikt');
select pg_temp.assert_eq((select kind || ':' || code from public.suggest_hall_location(:'b8') limit 1), 'fits:R7-E3',
  'leere Spalte: E3 vorgeschlagen');

-- ---------------------------------------------------------------------------
-- 2. Korrekte Reihenfolge: von oben nach unten einlagern, späteste Abholung oben
-- ---------------------------------------------------------------------------
-- p_key_code wird seit 0.18.0 ignoriert (ältere Tablets senden ihn noch)
select public.move_vehicle(:'b8', 'R7-E3', 'Einlagern', 'K-140');
select pg_temp.assert_eq((select status from public.bookings where id = :'b8'), 'stored', 'Status eingelagert');
select pg_temp.assert_eq(to_regclass('public.keys') is null, true, 'keine Schlüsseltabelle (Fach = Stellplatz)');
-- Vorschlag für Abholung in 6 Tagen: R7-E2 (passt unter E3 mit 8 Tagen, enger als leere Spalte R8)
select pg_temp.assert_eq((select code from public.suggest_hall_location(:'b6') limit 1), 'R7-E2', 'enge Reihenfolge bevorzugt');
select public.move_vehicle(:'b6', 'R7-E2');
select public.move_vehicle(:'b4', 'R7-E1');
select pg_temp.assert_eq((select count(*)::int from public.check_column(7, 1)), 0, 'korrekte Reihenfolge ohne Konflikt');
select pg_temp.assert_eq((select status from public.locations where code = 'R7-E1'), 'occupied', 'R7-E1 belegt');

-- ---------------------------------------------------------------------------
-- 3. Gesperrte Ebene: R8-E3 frei, aber R8-E1 belegt → nur mit Umsetzen
-- ---------------------------------------------------------------------------
select public.move_vehicle(:'b2', 'R8-E1');
select pg_temp.assert_eq((select status from public.locations where code = 'R8-E3'), 'blocked', 'R8-E3 gesperrt');
select pg_temp.assert_eq((select kind || ':' || moves from public.suggest_hall_location(:'b6') where code = 'R8-E3'),
  'relocate:2', 'gesperrter Platz kostet 2 Bewegungen');
do $$
begin
  perform public.move_vehicle((select id from public.bookings where external_ref = 'H-4'), 'R8-E3');
  raise exception 'FEHLER: Einlagern auf gesperrte Ebene erlaubt';
exception when raise_exception then
  if sqlerrm not like '%nur mit Umsetzen%' then raise; end if;
end;
$$;
-- Auslagern nur von unten nach oben: R7-E2 kommt nicht raus, solange R7-E1 belegt ist
do $$
begin
  perform public.move_vehicle((select id from public.bookings where external_ref = 'H-6'), 'W-UEB');
  raise exception 'FEHLER: Auslagern über belegter Ebene erlaubt';
exception when raise_exception then
  if sqlerrm not like '%darunter steht M-RT 4%' then raise; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Konflikt nach Umbuchung: E1 (4 Tage) wird auf 10 Tage verlängert → blockiert E2 und E3
-- ---------------------------------------------------------------------------
select public.upsert_booking(jsonb_build_object('external_ref', 'H-4', 'end_at', now() + interval '10 days'), 'regaltest');
select pg_temp.assert_eq((select count(*)::int from public.check_column(7, 1)), 2, 'zwei Konfliktpaare');
select pg_temp.assert_eq((select max(moves) from public.check_column(7, 1)), 2, 'Umsetzvorgänge angezeigt');
select pg_temp.assert_eq((select count(*)::int from public.tasks
  where type = 'relocate' and status = 'open' and booking_id = :'b4'), 2, 'Umsetz-Aufgaben für den Blockierer');
select pg_temp.assert_eq((select due_at < (select end_at from public.bookings where id = :'b6') from public.tasks
  where type = 'relocate' and booking_id = :'b4' and related_booking_id = :'b6'), true, 'fällig vor der früheren Abholung');
-- Umsetz-Aufgaben zählen nicht für „bereit“
select pg_temp.assert_eq((select status from public.bookings where id = :'b4') <> 'in_service', true, 'Status unberührt');
-- Erneute Prüfung legt keine Duplikate an
select public.upsert_booking(jsonb_build_object('external_ref', 'H-4', 'end_at', now() + interval '11 days'), 'regaltest');
select pg_temp.assert_eq((select count(*)::int from public.tasks where type = 'relocate' and status = 'open'
  and booking_id = :'b4'), 2, 'keine doppelten Umsetz-Aufgaben');

-- Konflikt lösen: Blockierer in den Puffer → Aufgaben automatisch erledigt
select public.move_vehicle(:'b4', 'P-01', 'Umsetzen');
select pg_temp.assert_eq((select count(*)::int from public.tasks where type = 'relocate' and status = 'open'
  and booking_id = :'b4'), 0, 'Umsetz-Aufgaben nach Auflösung erledigt');
select pg_temp.assert_eq((select status from public.locations where code = 'R7-E1'), 'free', 'R7-E1 wieder frei');

-- Vorschlag meldet Konflikt, wenn darüber früher abgeholt wird
select pg_temp.assert_eq((select kind from public.suggest_hall_location(:'b4') where code = 'R7-E1'), 'conflict',
  'Konflikt im Vorschlag erkannt');
-- Abweichung erlaubt, aber mit Warnung
select pg_temp.assert_eq(jsonb_array_length(public.move_vehicle(:'b4', 'R7-E1') -> 'warnings') >= 1, true,
  'Abweichung erzeugt Warnung');

-- ---------------------------------------------------------------------------
-- 5. Auschecken: Übergabe beendet die Buchung und gibt Schlüssel frei
-- ---------------------------------------------------------------------------
select public.move_vehicle(:'b2', 'W-UEB', 'Übergabe vorbereiten');
select pg_temp.assert_eq((select status from public.locations where code = 'R8-E3'), 'free', 'R8 wieder frei');
-- R7-E3 kann nicht übergeben werden, solange darunter Fahrzeuge stehen
do $$
begin
  perform public.move_vehicle((select id from public.bookings where external_ref = 'H-8'), null, 'Übergeben');
  raise exception 'FEHLER: Übergabe über belegten Ebenen erlaubt';
exception when raise_exception then
  if sqlerrm not like '%Auslagern von R7-E3 nicht möglich%' then raise; end if;
end;
$$;
-- Übergabe aus der Übergabezone: Buchung abgeschlossen
select public.move_vehicle(:'b2', null, 'Übergeben');
select pg_temp.assert_eq((select status from public.bookings where id = :'b2'), 'completed', 'Übergabe schließt Buchung ab');
select pg_temp.assert_eq((select count(*)::int from public.vehicle_movements where booking_id = :'b2'), 3,
  'lückenlose Bewegungshistorie');
reset role;
reset request.jwt.claim.sub;
\o
\echo '  ✓ 40_hall_logic'
