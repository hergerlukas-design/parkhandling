-- Tests für Rolle „Fahrer“ und Mehrfachrollen
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

-- Konten: Admin A, Personal P, Fahrer F (nur Fahrer), Personal+Fahrer M
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c5', 'admin-rolle@example.com'),
  ('00000000-0000-0000-0000-0000000000c6', 'personal-rolle@example.com'),
  ('00000000-0000-0000-0000-0000000000c7', 'fahrer-rolle@example.com'),
  ('00000000-0000-0000-0000-0000000000c8', 'beides-rolle@example.com');
update public.profiles set active = true where id::text like '00000000-0000-0000-0000-0000000000c%';

-- Ältere App setzt role → roles folgt
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c5';
select pg_temp.assert_eq((select roles from public.profiles where id = '00000000-0000-0000-0000-0000000000c5'),
  array['admin', 'staff'], 'role=admin ergänzt admin');
-- Neue App setzt roles → role folgt
update public.profiles set roles = array['driver'] where id = '00000000-0000-0000-0000-0000000000c7';
update public.profiles set roles = array['staff', 'driver'] where id = '00000000-0000-0000-0000-0000000000c8';
select pg_temp.assert_eq((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000c7'), 'staff', 'Fahrer: role staff (alt)');
select pg_temp.assert_eq((select roles from public.profiles where id = '00000000-0000-0000-0000-0000000000c8'),
  array['driver', 'staff'], 'sortiert, ohne Doppelte');
update public.profiles set roles = array['admin', 'driver'] where id = '00000000-0000-0000-0000-0000000000c8';
select pg_temp.assert_eq((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000c8'), 'admin', 'admin in roles → role admin');
update public.profiles set roles = array['staff', 'driver'] where id = '00000000-0000-0000-0000-0000000000c8';
-- Ungültige Rolle und leere Liste werden abgelehnt
do $$ begin
  update public.profiles set roles = array['chef'] where id = '00000000-0000-0000-0000-0000000000c6';
  raise exception 'FEHLER: unbekannte Rolle angenommen';
exception when check_violation then null; end $$;
do $$ begin
  update public.profiles set roles = '{}' where id = '00000000-0000-0000-0000-0000000000c6';
  raise exception 'FEHLER: leere Rollenliste angenommen';
exception when check_violation then null; end $$;

-- Letzter Admin: nur noch Admins aus Seeds/anderen Tests prüfen → hier eigener Fall
do $$
declare v_other int;
begin
  select count(*) into v_other from public.profiles where 'admin' = any (roles) and active and id <> '00000000-0000-0000-0000-0000000000c5';
  if v_other = 0 then
    begin
      update public.profiles set roles = array['staff'] where id = '00000000-0000-0000-0000-0000000000c5';
      raise exception 'FEHLER: letzter Admin herabgestuft';
    exception when sqlstate 'P0001' then null; end;
  end if;
end $$;

-- Shuttle-Buchung für die Fahreransicht
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c6';
select (public.upsert_booking('{
  "external_ref": "FR01", "customer_name": "Fahrer Test", "plate": "M-FR 101", "persons": 2,
  "start_at": "2031-05-05T10:00:00+02:00", "end_at": "2031-05-08T12:00:00+02:00",
  "parking_type": "outdoor", "return_mode": "shuttle"
}'::jsonb, 'test') ->> 'id') as b1 \gset

-- Reiner Fahrer: keine Buchungen, keine Buchungsfunktionen, aber Shuttle
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c7';
select pg_temp.assert_eq(public.is_staff(), false, 'Fahrer ist kein Personal');
select pg_temp.assert_eq(public.is_driver(), true, 'Fahrer');
select pg_temp.assert_eq((select count(*)::int from public.bookings), 0, 'Fahrer sieht keine Buchungen');
select pg_temp.assert_eq((select count(*)::int from public.tasks), 0, 'Fahrer sieht keine Aufgaben');
do $$ begin
  perform public.upsert_booking('{"external_ref": "FR02", "customer_name": "x", "plate": "M-FR 2", "start_at": "2031-05-05T10:00:00+02:00", "end_at": "2031-05-06T10:00:00+02:00"}'::jsonb, 'test');
  raise exception 'FEHLER: Fahrer durfte Buchung anlegen';
exception when insufficient_privilege then null; end $$;
select pg_temp.assert_eq(
  (select count(*)::int from public.transport_board('2031-05-05T00:00:00+02:00', '2031-05-06T00:00:00+02:00')), 1, 'Fahrer sieht Fahrt');
select pg_temp.assert_eq(
  (select passengers -> 0 ->> 'plate' from public.transport_board('2031-05-05T00:00:00+02:00', '2031-05-06T00:00:00+02:00')),
  'M-FR 101', 'mit Kennzeichen');
select id as job from public.transport_board('2031-05-05T00:00:00+02:00', '2031-05-06T00:00:00+02:00') \gset
update public.transport_jobs set status = 'underway', driver_id = '00000000-0000-0000-0000-0000000000c7' where id = :'job';
select pg_temp.assert_eq((select status from public.transport_jobs where id = :'job'), 'underway', 'Fahrer setzt Status');
do $$ begin
  perform public.move_transport_passenger(
    (select p.id from public.transport_passengers p join public.bookings b on b.id = p.booking_id limit 1), null, now());
  raise exception 'FEHLER: Fahrer durfte umsetzen';
exception when insufficient_privilege then null; end $$;
-- Push-Gerät und Einstellungen für Fahrer
select pg_temp.assert_eq(
  (select count(*)::int from public.settings where key in ('notifications', 'push_vapid_public_key')), 2, 'Fahrer liest Push-Einstellungen');
select pg_temp.assert_eq((select count(*)::int from public.settings where key = 'email_templates'), 0, 'sonst keine Einstellungen');
select (public.save_push_subscription('https://push.example.com/fahrer', 'k', 'a', 'Handy Fahrer', 'dev-fahrer', 'test')).events as ev_driver \gset
select pg_temp.assert_eq(:'ev_driver'::text[], array['shuttle_due'], 'Fahrer: nur Shuttle fällig');

-- Personal+Fahrer: alles wie Personal plus Shuttle
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c8';
select pg_temp.assert_eq(public.is_staff(), true, 'Personal+Fahrer ist Personal');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'FR01'), 1, 'sieht Buchungen');

-- Fahrerauswahl: nur Konten mit Rolle Fahrer
select pg_temp.assert_eq(
  (select array_agg(id order by id)::text from public.list_drivers()),
  array['00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000c8']::uuid[]::text, 'Fahrerliste');

reset role;

-- Vorbelegung und Empfänger je Rollenliste
select pg_temp.assert_eq('shuttle_due' = any (public.default_push_events(array['driver'])), true, 'driver → shuttle_due');
select pg_temp.assert_eq('booking_new' = any (public.default_push_events(array['driver'])), false, 'driver → keine Buchungen');
select pg_temp.assert_eq('booking_review' = any (public.default_push_events(array['admin'])), true, 'admin → review');
select pg_temp.assert_eq('booking_new' = any (public.default_push_events(array['admin'])), true, 'admin zählt als staff');
select pg_temp.assert_eq('booking_review' = any (public.default_push_events('staff')), false, 'alte Signatur');
select pg_temp.assert_eq(
  (select value #> '{events,shuttle_due,roles}' from public.settings where key = 'notifications'),
  '["driver", "staff"]'::jsonb, 'shuttle_due an Fahrer und Personal');

-- Meldung an Rolle driver erreicht nur Fahrer-Konten
update public.settings set value = jsonb_set(value, '{events,booking_ready,roles}', '["driver"]') where key = 'notifications';
select public.enqueue_notification('booking_ready', 'booking', :'b1', 'test-driver-ready', 'T', 'B') as nid \gset
update public.push_subscriptions set events = array['booking_ready', 'shuttle_due'] where endpoint = 'https://push.example.com/fahrer';
select pg_temp.assert_eq(
  (select array_agg(r.endpoint) from public.notifications n, lateral public.notification_recipients(n) r where n.id = :'nid'),
  array['https://push.example.com/fahrer'], 'nur Fahrer-Gerät');

\o
\echo '  ✓ 96_driver_role'
