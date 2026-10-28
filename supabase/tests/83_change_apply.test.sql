-- Parkos-Umbuchungen werden auf die bestehende Buchung übernommen (0.32.0)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b4', 'umbuchung@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000b4';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b4';

create temp table mail as select jsonb_build_object(
  'source', 'parkos', 'mail_type', 'new', 'raw_text', 'x', 'external_ref', 'CHG01', 'flags', '[]'::jsonb,
  'booking', jsonb_build_object('external_ref', 'CHG01', 'customer_name', 'Umbuchung Test', 'plate', 'M-CH 1',
    'customer_phone', '+43 680 1', 'start_at', '2030-10-29T09:00:00+01:00', 'end_at', '2030-11-01T19:15:00+01:00',
    'return_flight_at', '2030-11-01T18:15:00+01:00', 'parking_type', 'outdoor', 'return_mode', 'shuttle')) as p;

select (public.import_booking_mail((select p from mail)) ->> 'booking_id') as bid \gset

-- Umbuchung: Ankunft 08:30, neue Telefonnummer → übernommen, Verlauf „parkos“
select public.import_booking_mail(jsonb_set(jsonb_set(jsonb_set((select p from mail), '{mail_type}', '"change"'),
  '{booking,start_at}', '"2030-10-29T08:30:00+01:00"'), '{booking,customer_phone}', '"+43 680 2"')) as r1 \gset
select pg_temp.assert_eq((:'r1'::jsonb) ->> 'status', 'updated', 'Umbuchung übernommen');
select pg_temp.assert_eq((:'r1'::jsonb) ->> 'booking_id', :'bid', 'gleiche Buchung');
select pg_temp.assert_eq((select start_at from public.bookings where id = :'bid'), '2030-10-29T08:30:00+01:00'::timestamptz, 'Ankunft 08:30');
select pg_temp.assert_eq((select customer_phone from public.bookings where id = :'bid'), '+43 680 2', 'Telefon');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'CHG01'), 1, 'kein Duplikat');
select pg_temp.assert_eq((select count(*)::int from public.booking_history where booking_id = :'bid' and source = 'parkos'
  and changed_fields ? 'start_at'), 1, 'Verlauf');

-- Gleiche Umbuchung erneut → unverändert
select public.import_booking_mail(jsonb_set(jsonb_set(jsonb_set((select p from mail), '{mail_type}', '"change"'),
  '{booking,start_at}', '"2030-10-29T08:30:00+01:00"'), '{booking,customer_phone}', '"+43 680 2"')) as r2 \gset
select pg_temp.assert_eq((:'r2'::jsonb) ->> 'status', 'unchanged', 'zweimal unverändert');

-- Kennzeichen von Hand korrigiert → Umbuchung überschreibt es nicht, Rest wird übernommen, Hinweis zur Prüfung
select public.upsert_booking(jsonb_build_object('id', :'bid', 'plate', 'M-CH 11'), 'manual');
select public.import_booking_mail(jsonb_set(jsonb_set((select p from mail), '{mail_type}', '"change"'),
  '{booking,start_at}', '"2030-10-29T08:00:00+01:00"')) as r3 \gset
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'status', 'needs_review', 'Hand-Feld weicht ab');
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'error' like '%plate%', true, 'Feld genannt');
select pg_temp.assert_eq((select plate from public.bookings where id = :'bid'), 'M-CH 11', 'Kennzeichen von Hand bleibt');
select pg_temp.assert_eq((select start_at from public.bookings where id = :'bid'), '2030-10-29T08:00:00+01:00'::timestamptz, 'Ankunft trotzdem übernommen');

-- Umbuchung zu unbekannter Reservierung → Prüfung, keine neue Buchung
select public.import_booking_mail(jsonb_set(jsonb_set((select p from mail), '{mail_type}', '"change"'),
  '{booking,external_ref}', '"CHG99"')) as r4 \gset
select pg_temp.assert_eq((:'r4'::jsonb) ->> 'status', 'needs_review', 'unbekannt zur Prüfung');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'CHG99'), 0, 'nichts angelegt');

-- Stornierte Buchung → Prüfung, keine Änderung
select public.upsert_booking(jsonb_build_object('id', :'bid', 'cancelled', true), 'manual');
select public.import_booking_mail(jsonb_set(jsonb_set((select p from mail), '{mail_type}', '"change"'),
  '{booking,start_at}', '"2030-10-29T07:00:00+01:00"')) as r5 \gset
select pg_temp.assert_eq((:'r5'::jsonb) ->> 'status', 'needs_review', 'storniert zur Prüfung');
select pg_temp.assert_eq((select start_at from public.bookings where id = :'bid'), '2030-10-29T08:00:00+01:00'::timestamptz, 'storniert unverändert');

-- Stornomail bleibt zur Prüfung
select public.import_booking_mail(jsonb_set((select p from mail), '{mail_type}', '"cancel"')) as r6 \gset
select pg_temp.assert_eq((:'r6'::jsonb) ->> 'status', 'needs_review', 'Storno zur Prüfung');
reset role;

\o
\echo '  ✓ 83_change_apply'
