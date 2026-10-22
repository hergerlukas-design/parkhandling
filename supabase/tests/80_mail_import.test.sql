-- Tests für import_booking_mail (Parkos-Mailimport, manuell und IMAP)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'mailimport@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000b1';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';

-- Einstellungen sind vorhanden
select pg_temp.assert_eq((select value from public.settings where key = 'return_buffer_minutes'), '60'::jsonb, 'Puffer 60');
select pg_temp.assert_eq(
  (select value -> 0 ->> 'parking_type' from public.settings where key = 'parkos_product_map'), 'outdoor',
  'Produktzuordnung Seed');

-- Neue Reservierung → Buchung angelegt, Auszahlung und Flags gesetzt
select public.import_booking_mail('{
  "source": "parkos", "channel": "manual", "mail_type": "new", "external_ref": "TEST01",
  "subject": "Reservierung bei Parkos #TEST01", "raw_text": "Eine neue Reservierung über Parkos …",
  "flags": ["plate_unverified"], "portal_payout": 72,
  "booking": {
    "external_ref": "TEST01", "customer_name": "Erika Beispiel", "plate": "M-TE 101",
    "start_at": "2030-10-23T12:00:00+02:00", "end_at": "2030-10-28T13:00:00+01:00",
    "return_flight_at": "2030-10-28T12:00:00+01:00", "flight_out": "LH123", "flight_return": "LH234",
    "parking_type": "outdoor", "return_mode": "shuttle", "persons": 2,
    "price_total": 72, "payment_status": "paid", "customer_language": "de"
  }
}'::jsonb) as r1 \gset
select pg_temp.assert_eq((:'r1'::jsonb) ->> 'status', 'imported', 'importiert');
select (:'r1'::jsonb) ->> 'booking_id' as bid \gset
select pg_temp.assert_eq((select portal_payout from public.bookings where id = :'bid'), 72.00::numeric, 'Auszahlung');
select pg_temp.assert_eq((select import_flags from public.bookings where id = :'bid'), array['plate_unverified'], 'Flags');
select pg_temp.assert_eq((select flight_return from public.bookings where id = :'bid'), 'LH234', 'Flug');
select pg_temp.assert_eq((select source from public.bookings where id = :'bid'), 'parkos', 'Quelle');
select pg_temp.assert_eq((select booking_id from public.booking_imports where id = ((:'r1'::jsonb) ->> 'import_id')::uuid),
  :'bid'::uuid, 'Import verweist auf Buchung');

-- Gleiche Mail erneut → unverändert, kein Duplikat
select public.import_booking_mail(jsonb_set(
  '{"source": "parkos", "mail_type": "new", "raw_text": "x", "flags": ["plate_unverified"], "portal_payout": 72}'::jsonb,
  '{booking}',
  (select jsonb_build_object(
    'external_ref', 'TEST01', 'customer_name', 'Erika Beispiel', 'plate', 'M-TE 101',
    'start_at', '2030-10-23T12:00:00+02:00', 'end_at', '2030-10-28T13:00:00+01:00',
    'return_flight_at', '2030-10-28T12:00:00+01:00', 'flight_out', 'LH123', 'flight_return', 'LH234',
    'parking_type', 'outdoor', 'return_mode', 'shuttle', 'persons', 2,
    'price_total', 72, 'payment_status', 'paid', 'customer_language', 'de'))
)) as r2 \gset
select pg_temp.assert_eq((:'r2'::jsonb) ->> 'status', 'unchanged', 'zweiter Import unverändert');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'TEST01'), 1, 'kein Duplikat');

-- Geänderte Zeiten derselben Nummer → aktualisiert + Historie
select public.import_booking_mail('{
  "source": "parkos", "mail_type": "new", "raw_text": "x",
  "booking": {"external_ref": "TEST01", "customer_name": "Erika Beispiel", "plate": "M-TE 101",
    "start_at": "2030-10-23T12:00:00+02:00", "end_at": "2030-10-29T13:00:00+01:00",
    "return_flight_at": "2030-10-29T12:00:00+01:00", "parking_type": "outdoor"}
}'::jsonb) as r3 \gset
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'status', 'updated', 'aktualisiert');
select pg_temp.assert_eq(
  (select count(*)::int from public.booking_history where booking_id = :'bid' and changed_fields ? 'return_flight_at'), 1,
  'Historie für Landung');

-- Storno-Mail → nur Prüfliste, Buchung unverändert
select public.import_booking_mail('{
  "source": "parkos", "mail_type": "cancel", "external_ref": "TEST01", "raw_text": "Ihre Reservierung wurde storniert",
  "booking": {"external_ref": "TEST01", "customer_name": "Erika Beispiel", "plate": "M-TE 101",
    "start_at": "2030-10-23T12:00:00+02:00", "end_at": "2030-10-29T13:00:00+01:00", "parking_type": "outdoor",
    "cancelled": true}
}'::jsonb) as r4 \gset
select pg_temp.assert_eq((:'r4'::jsonb) ->> 'status', 'needs_review', 'Storno zur Prüfung');
select pg_temp.assert_eq((select status from public.bookings where id = :'bid'), 'booked', 'Buchung nicht storniert');

-- Unbekannte Parkform → Prüfliste, keine Buchung
select public.import_booking_mail('{
  "source": "parkos", "mail_type": "new", "external_ref": "TEST02", "raw_text": "x", "flags": ["unknown_product"],
  "booking": {"external_ref": "TEST02", "customer_name": "Otto Test", "plate": "M-OT 2",
    "start_at": "2030-10-23T12:00:00+02:00", "end_at": "2030-10-29T13:00:00+01:00", "parking_type": "outdoor"}
}'::jsonb) as r5 \gset
select pg_temp.assert_eq((:'r5'::jsonb) ->> 'status', 'needs_review', 'unbekannte Parkform zur Prüfung');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'TEST02'), 0, 'keine Buchung');

-- Fehler in der Buchung → failed, Import bleibt protokolliert
select public.import_booking_mail('{
  "source": "parkos", "mail_type": "new", "external_ref": "TEST03", "raw_text": "x",
  "booking": {"external_ref": "TEST03", "customer_name": "Fehler Fall", "plate": "M-FF 3",
    "start_at": "2030-10-29T12:00:00+02:00", "end_at": "2030-10-23T13:00:00+01:00", "parking_type": "outdoor"}
}'::jsonb) as r6 \gset
select pg_temp.assert_eq((:'r6'::jsonb) ->> 'status', 'failed', 'Fehler protokolliert');
select pg_temp.assert_eq((select count(*)::int from public.booking_imports where external_ref = 'TEST03'), 1, 'Import gespeichert');

-- Prüfliste abhaken
select public.resolve_booking_import(((:'r4'::jsonb) ->> 'import_id')::uuid, 'telefonisch geklärt');
select pg_temp.assert_eq(
  (select status from public.booking_imports where id = ((:'r4'::jsonb) ->> 'import_id')::uuid), 'resolved', 'erledigt');

-- Mitarbeiter dürfen Importe lesen, aber nicht direkt schreiben
do $$
begin
  insert into public.booking_imports (raw_text, status) values ('x', 'imported');
  raise exception 'FEHLER: Mitarbeiter konnte booking_imports direkt beschreiben';
exception when insufficient_privilege then null;
end;
$$;

reset role;
reset request.jwt.claim.sub;

-- Service-Zugang (späterer IMAP-Abruf) darf importieren
set role service_role;
set request.jwt.claim.role = 'service_role';
select public.import_booking_mail('{
  "source": "parkos", "channel": "imap", "mail_type": "new", "external_ref": "TEST04", "raw_text": "x",
  "booking": {"external_ref": "TEST04", "customer_name": "Imap Test", "plate": "M-IM 4",
    "start_at": "2030-10-23T12:00:00+02:00", "end_at": "2030-10-29T13:00:00+01:00", "parking_type": "outdoor"}
}'::jsonb) as r7 \gset
select pg_temp.assert_eq((:'r7'::jsonb) ->> 'status', 'imported', 'IMAP-Import');
reset role;
reset request.jwt.claim.role;

-- Anonyme Aufrufer dürfen nicht
set role anon;
do $$
begin
  perform public.import_booking_mail('{"mail_type": "new", "raw_text": "x"}'::jsonb);
  raise exception 'FEHLER: anonym importiert';
exception when insufficient_privilege then null;
end;
$$;
reset role;

\o
\echo '  ✓ 80_mail_import'
