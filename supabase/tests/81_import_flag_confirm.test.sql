-- Import-Hinweise quittieren: „Kennzeichen prüfen“ bestätigen (0.31.0)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'flagconfirm@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000b2';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';

create temp table mail as select jsonb_build_object(
  'source', 'parkos', 'mail_type', 'new', 'raw_text', 'x', 'flags', jsonb_build_array('plate_unverified', 'phone_missing'),
  'booking', jsonb_build_object('external_ref', 'FLAG01', 'customer_name', 'Flag Test', 'plate', 'M-FL 1',
    'start_at', '2030-11-01T10:00:00+01:00', 'end_at', '2030-11-05T19:00:00+01:00', 'parking_type', 'outdoor')) as p;

select (public.import_booking_mail((select p from mail)) ->> 'booking_id') as bid \gset
select pg_temp.assert_eq((select import_flags from public.bookings where id = :'bid'),
  array['plate_unverified', 'phone_missing'], 'Flags nach Import');

-- Bestätigen entfernt den Hinweis und schreibt den Verlauf
select pg_temp.assert_eq(public.confirm_booking_import_flag(:'bid', 'plate_unverified'), array['phone_missing'], 'Rückgabe');
select pg_temp.assert_eq((select import_flags from public.bookings where id = :'bid'), array['phone_missing'], 'Flag weg');
select pg_temp.assert_eq((select count(*)::int from public.booking_history
  where booking_id = :'bid' and changed_fields ? 'import_confirmed'), 1, 'Verlauf');

-- Gleiche Mail erneut → bestätigter Hinweis kommt nicht zurück
select public.import_booking_mail((select p from mail));
select pg_temp.assert_eq((select import_flags from public.bookings where id = :'bid'), array['phone_missing'], 'bleibt bestätigt');

-- Nicht offener Hinweis → Fehler
do $$
begin
  perform public.confirm_booking_import_flag((select id from public.bookings where external_ref = 'FLAG01'), 'plate_unverified');
  raise exception 'FEHLER: doppelt bestätigt';
exception when no_data_found then null;
end;
$$;

-- Kennzeichen von Hand korrigiert → gilt als geprüft
select (public.import_booking_mail(jsonb_set((select p from mail), '{booking,external_ref}', '"FLAG02"')) ->> 'booking_id') as bid2 \gset
select public.upsert_booking(jsonb_build_object('id', :'bid2', 'plate', 'M-FL 2'), 'manual');
select pg_temp.assert_eq((select import_flags from public.bookings where id = :'bid2'), array['phone_missing'], 'Korrektur = geprüft');
reset role;

-- Anonyme Aufrufer dürfen nicht
set role anon;
do $$
begin
  perform public.confirm_booking_import_flag(gen_random_uuid(), 'plate_unverified');
  raise exception 'FEHLER: anonym bestätigt';
exception when insufficient_privilege then null;
end;
$$;
reset role;

\o
\echo '  ✓ 81_import_flag_confirm'
