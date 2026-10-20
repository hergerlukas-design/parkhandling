-- Fehlerprotokoll (0.22.0): nur angemeldete Nutzer melden, gleiche Fehler werden gezählt,
-- nur Admins lesen
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'err-admin@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'err-personal@example.com');
update public.profiles set active = true, role = 'admin' where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set active = true, role = 'staff' where id = '00000000-0000-0000-0000-0000000000f2';

set role authenticated;

-- Ohne Anmeldung wird nichts gespeichert
reset request.jwt.claim.sub;
select public.log_client_error('error', 'ohne Login');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select public.log_client_error('error', 'TypeError: x is undefined (Buchung 4711)', E'TypeError\n    at foo (app.js:1:2)', '/fahrzeuge/1');
select public.log_client_error('error', 'TypeError: x is undefined (Buchung 4712)', E'TypeError\n    at foo (app.js:1:2)', '/fahrzeuge/2');
select public.log_client_error('unhandledrejection', 'Netzwerk weg', null, '/heute');

-- Personal sieht nichts, auch nicht die eigenen Einträge
select pg_temp.assert_eq((select count(*)::int from public.client_errors), 0, 'Personal liest keine Fehler');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.assert_eq((select count(*)::int from public.client_errors), 2, 'gleiche Fehler zusammengefasst, Login-lose verworfen');
select pg_temp.assert_eq((select occurrences from public.client_errors where kind = 'error'), 2, 'Wiederholung gezählt');
select pg_temp.assert_eq((select user_id from public.client_errors where kind = 'error'),
  '00000000-0000-0000-0000-0000000000f2'::uuid, 'Nutzer wird vermerkt');

-- Admin darf Einträge löschen
delete from public.client_errors where kind = 'unhandledrejection';
select pg_temp.assert_eq((select count(*)::int from public.client_errors), 1, 'Admin löscht');
reset role;

-- Bereinigung nach 90 Tagen
update public.client_errors set last_seen_at = now() - interval '91 days';
select pg_temp.assert_eq(public.purge_client_errors(), 1, 'alte Einträge bereinigt');

\o
\echo '  ✓ 90_client_errors'
