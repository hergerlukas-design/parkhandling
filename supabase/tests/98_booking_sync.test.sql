-- Buchungen aus dem CarHandling-Backend übernehmen (0.35.0)
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

-- Angemeldete Mitarbeiter dürfen die Funktion nicht aufrufen
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c9', 'syncstaff@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000c9';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c9';
do $$
begin
  perform public.sync_external_booking('{"external_ref": "CH-X"}'::jsonb);
  raise exception 'FEHLER: authenticated darf sync_external_booking nicht aufrufen';
exception when insufficient_privilege then null;
end;
$$;
reset role;
reset request.jwt.claim.sub;

set role service_role;
set request.jwt.claim.role = 'service_role';

create temp table b1 as select jsonb_build_object(
  'source', 'carhandling', 'external_ref', 'PF-SYNC0001', 'event', 'change', 'tariff_code', 'economy',
  'raw', jsonb_build_object('booking_ref', 'PF-SYNC0001'),
  'booking', jsonb_build_object('customer_name', 'Sync Test', 'plate', 'M-SY 1',
    'start_at', '2030-12-01T09:00:00Z', 'end_at', '2030-12-07T11:00:00Z', 'price_total', 64,
    'payment_status', 'open', 'notes', 'Übernommen aus dem CarHandling-Buchungsbackend')) as p;

-- 1) Neu: Buchung angelegt, Stellplatzart aus dem Tarif, Tarif gesetzt, Protokoll vorhanden
select public.sync_external_booking((select p from b1)) as r1 \gset
select (:'r1'::jsonb) ->> 'booking_id' as bid \gset
select pg_temp.assert_eq((:'r1'::jsonb) ->> 'status', 'imported', 'angelegt');
select pg_temp.assert_eq((select source from public.bookings where id = :'bid'), 'carhandling', 'Quelle');
select pg_temp.assert_eq((select parking_type from public.bookings where id = :'bid'), 'outdoor', 'Stellplatzart aus Tarif');
select pg_temp.assert_eq((select tariff_code from public.bookings where id = :'bid'), 'economy', 'Tarif');
select pg_temp.assert_eq((select count(*)::int from public.booking_imports where booking_id = :'bid' and channel = 'webhook' and status = 'imported'), 1, 'Protokoll');
-- Economy: Grundreinigung ausgeschlossen
select pg_temp.assert_eq((select count(*)::int from public.booking_services bs join public.services s on s.id = bs.service_id
  where bs.booking_id = :'bid' and s.code = 'GRUND' and bs.status = 'active'), 0, 'Economy ohne Grundreinigung');

-- 2) Gleicher Aufruf noch einmal: kein Doppel, kein neuer Protokolleintrag
select public.sync_external_booking((select p from b1)) as r2 \gset
select pg_temp.assert_eq((:'r2'::jsonb) ->> 'status', 'unchanged', 'unverändert');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'PF-SYNC0001'), 1, 'kein Doppel');
select pg_temp.assert_eq((select count(*)::int from public.booking_imports where external_ref = 'PF-SYNC0001'), 1, 'kein zweites Protokoll');

-- 3) Zahlung per Stripe eingegangen → bezahlt
update b1 set p = jsonb_set(p, '{booking,payment_status}', '"paid"');
select public.sync_external_booking((select p from b1)) as r3 \gset
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'status', 'updated', 'aktualisiert');
select pg_temp.assert_eq((select payment_status from public.bookings where id = :'bid'), 'paid', 'bezahlt');

-- 4) Späterer Datensatz mit „offen“ setzt „bezahlt“ nicht zurück, Umbuchung kommt an
update b1 set p = jsonb_set(jsonb_set(p, '{booking,payment_status}', '"open"'), '{booking,end_at}', '"2030-12-08T11:00:00Z"');
select public.sync_external_booking((select p from b1));
select pg_temp.assert_eq((select payment_status from public.bookings where id = :'bid'), 'paid', 'bleibt bezahlt');
select pg_temp.assert_eq((select end_at from public.bookings where id = :'bid'), '2030-12-08T11:00:00Z'::timestamptz, 'Umbuchung');

-- 5) Storno
select public.sync_external_booking('{"source": "carhandling", "external_ref": "PF-SYNC0001", "event": "cancel",
  "booking": {"cancelled": true}}'::jsonb) as r5 \gset
select pg_temp.assert_eq((:'r5'::jsonb) ->> 'status', 'updated', 'Storno verarbeitet');
select pg_temp.assert_eq((select status from public.bookings where id = :'bid'), 'cancelled', 'storniert');

-- 6) Storno einer unbekannten Buchung: nichts passiert
select public.sync_external_booking('{"source": "carhandling", "external_ref": "PF-UNBEKANNT", "event": "cancel",
  "booking": {"cancelled": true}}'::jsonb) as r6 \gset
select pg_temp.assert_eq((:'r6'::jsonb) ->> 'status', 'unchanged', 'unbekannter Storno');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'PF-UNBEKANNT'), 0, 'nicht angelegt');

-- 7) Zuordnung fehlgeschlagen → Prüfliste, keine Buchung
select public.sync_external_booking('{"source": "carhandling", "external_ref": "PF-KAPUTT", "event": "change",
  "error": "Pflichtangaben fehlen: Kennzeichen", "raw": {"booking_ref": "PF-KAPUTT"}}'::jsonb) as r7 \gset
select pg_temp.assert_eq((:'r7'::jsonb) ->> 'status', 'failed', 'fehlgeschlagen');
select pg_temp.assert_eq((select error from public.booking_imports where external_ref = 'PF-KAPUTT'), 'Pflichtangaben fehlen: Kennzeichen', 'Fehler in Prüfliste');
select pg_temp.assert_eq((select count(*)::int from public.bookings where external_ref = 'PF-KAPUTT'), 0, 'keine Buchung');

-- 8) Datenbankfehler (Ende vor Beginn) wird abgefangen und protokolliert
select public.sync_external_booking('{"source": "carhandling", "external_ref": "PF-ZEIT", "event": "change",
  "booking": {"customer_name": "X", "plate": "M-X 1", "parking_type": "outdoor",
              "start_at": "2030-12-07T09:00:00Z", "end_at": "2030-12-01T09:00:00Z"}}'::jsonb) as r8 \gset
select pg_temp.assert_eq((:'r8'::jsonb) ->> 'status', 'failed', 'Datenbankfehler abgefangen');
select pg_temp.assert_eq((select status from public.booking_imports where external_ref = 'PF-ZEIT'), 'failed', 'protokolliert');

-- 9) Premium: enthaltene Leistung gebucht
select public.sync_external_booking('{"source": "carhandling", "external_ref": "PF-PREMIUM", "event": "change",
  "tariff_code": "premium", "booking": {"customer_name": "P", "plate": "M-P 1",
  "start_at": "2030-12-01T09:00:00Z", "end_at": "2030-12-07T09:00:00Z"}}'::jsonb) as r9 \gset
select pg_temp.assert_eq((select parking_type from public.bookings where id = ((:'r9'::jsonb) ->> 'booking_id')::uuid), 'indoor', 'Premium in der Halle');
select pg_temp.assert_eq((select count(*)::int from public.booking_services bs join public.services s on s.id = bs.service_id
  where bs.booking_id = ((:'r9'::jsonb) ->> 'booking_id')::uuid and s.code in ('AUSSEN', 'CARCOVER', 'CHECK')), 3, 'Premium-Leistungen');

reset role;
\o
\echo '  ✓ 98_booking_sync'
