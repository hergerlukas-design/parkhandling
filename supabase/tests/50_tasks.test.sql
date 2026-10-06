-- Aufgaben-Board: Stempel für Beginn/Erledigt, Fotoanzahl, Status „bereit“
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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'pflege@example.com', '{"name": "Mitarbeiter 1"}');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000d1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';

select public.upsert_booking(jsonb_build_object('external_ref', 'T-1', 'customer_name', 'Aufgabe', 'plate', 'M-AT 1',
  'start_at', now(), 'end_at', now() + interval '3 days', 'parking_type', 'outdoor', 'services', jsonb_build_array('AUF_INNEN')), 'aufgabentest') ->> 'id' as bid \gset
select public.move_vehicle(:'bid', 'B1-20', 'Einlagern');
select id as tid from public.tasks where booking_id = :'bid' and title = 'Aufbereitung innen' \gset

-- Beginnen stempelt Person und Zeit
update public.tasks set status = 'in_progress' where id = :'tid';
select pg_temp.assert_eq((select started_by_name from public.task_board where id = :'tid'), 'Mitarbeiter 1', 'begonnen von');
select pg_temp.assert_eq((select booking_status from public.task_board where id = :'tid'), 'in_service', 'Fahrzeug in Arbeit');
select pg_temp.assert_eq((select location_code from public.task_board where id = :'tid'), 'B1-20', 'Ort im Board');

-- Teilschritte abhaken
update public.tasks set checklist = (select jsonb_agg(c || '{"done": true}') from jsonb_array_elements(checklist) c) where id = :'tid';
select pg_temp.assert_eq((select bool_and((c ->> 'done')::boolean) from public.tasks, jsonb_array_elements(checklist) c where id = :'tid'), true, 'Checkliste erledigt');

-- Fotos zählen nur, wenn hochgeladen
insert into public.media (booking_id, owner_type, owner_id, kind, bucket, path, uploaded_at) values
  (:'bid', 'task', :'tid', 'photo', 'media', 'x/1.webp', now()),
  (:'bid', 'task', :'tid', 'photo', 'media', 'x/2.webp', null);
select pg_temp.assert_eq((select photo_count from public.task_board where id = :'tid'), 1, 'nur hochgeladene Fotos');

-- Alle Leistungen erledigt → „bereit“
update public.tasks set status = 'done' where booking_id = :'bid' and type <> 'relocate';
select pg_temp.assert_eq((select status from public.bookings where id = :'bid'), 'ready', 'bereit');
select pg_temp.assert_eq((select done_by_name from public.task_board where id = :'tid'), 'Mitarbeiter 1', 'erledigt von');
select pg_temp.assert_eq((select started_by_name from public.task_board where id = :'tid'), 'Mitarbeiter 1', 'Beginn bleibt erhalten');

-- Zurücksetzen auf offen löscht Stempel
update public.tasks set status = 'open' where id = :'tid';
select pg_temp.assert_eq((select started_by is null and done_by is null from public.tasks where id = :'tid'), true, 'Stempel gelöscht');
select pg_temp.assert_eq((select status from public.bookings where id = :'bid'), 'stored', 'zurück auf eingelagert');

-- Inaktives Konto sieht das Board nicht
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d2', 'fremd@example.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
select pg_temp.assert_eq((select count(*)::int from public.task_board), 0, 'RLS greift im Board');
reset role;
reset request.jwt.claim.sub;
\o
\echo '  ✓ 50_tasks'
