-- Tests für upsert_booking (Buchungsschnittstelle)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'import@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000a1';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- Neuanlage
select public.upsert_booking('{
  "external_ref": "CSV-1", "customer_name": "Max Muster", "plate": "S-MM 42",
  "start_at": "2030-05-01T06:00:00+02:00", "end_at": "2030-05-08T20:00:00+02:00",
  "parking_type": "indoor", "services": ["auf_innen", "LADEN", "GIBTSNICHT"]
}'::jsonb, 'csv') as r1 \gset
select pg_temp.assert_eq((:'r1'::jsonb) ->> 'action', 'created', 'angelegt');
select pg_temp.assert_eq((:'r1'::jsonb) -> 'unknown_services', '["GIBTSNICHT"]'::jsonb, 'unbekannte Leistung gemeldet');
select (:'r1'::jsonb) ->> 'id' as bid \gset
select pg_temp.assert_eq((select count(*)::int from public.tasks where booking_id = :'bid'), 3,
  'Grundreinigung + 2 Leistungen');

-- Gleicher Import erneut → unverändert, keine Historie
select public.upsert_booking('{
  "external_ref": "CSV-1", "customer_name": "Max Muster", "plate": "S-MM 42",
  "start_at": "2030-05-01T06:00:00+02:00", "end_at": "2030-05-08T20:00:00+02:00",
  "parking_type": "indoor", "services": ["AUF_INNEN", "LADEN"]
}'::jsonb, 'csv') as r2 \gset
select pg_temp.assert_eq((:'r2'::jsonb) ->> 'action', 'unchanged', 'idempotent');
select pg_temp.assert_eq((:'r2'::jsonb) ->> 'id', :'bid', 'gleiche Buchung');

-- Umbuchung: neue Abholzeit, LADEN storniert, AUSSEN neu
select public.upsert_booking('{
  "external_ref": "CSV-1", "end_at": "2030-05-09T20:00:00+02:00", "services": ["AUF_INNEN", "AUF_AUSSEN"]
}'::jsonb, 'csv') as r3 \gset
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'action', 'updated', 'umgebucht');
select pg_temp.assert_eq(
  (select source from public.booking_history where booking_id = :'bid' and changed_fields ? 'end_at'), 'csv',
  'Historie mit Quelle csv');
select pg_temp.assert_eq(
  (select t.status from public.tasks t join public.services s on s.id = t.service_id
   where t.booking_id = :'bid' and s.code = 'LADEN'), 'cancelled', 'LADEN-Aufgabe storniert');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks t join public.services s on s.id = t.service_id
   where t.booking_id = :'bid' and s.code = 'GRUND' and t.status = 'open'), 1, 'Grundreinigung bleibt');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks t join public.services s on s.id = t.service_id
   where t.booking_id = :'bid' and s.code = 'AUF_AUSSEN' and t.status = 'open'), 1, 'AUSSEN-Aufgabe neu');
select pg_temp.assert_eq((select customer_name from public.bookings where id = :'bid'), 'Max Muster',
  'fehlende Felder bleiben erhalten');

-- LADEN wieder gebucht → reaktiviert, neue offene Aufgabe
select public.upsert_booking('{"external_ref": "CSV-1", "services": ["AUF_INNEN", "AUF_AUSSEN", "LADEN"]}'::jsonb, 'csv');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks t join public.services s on s.id = t.service_id
   where t.booking_id = :'bid' and s.code = 'LADEN' and t.status = 'open'), 1, 'LADEN reaktiviert');

-- Andere Quelle, gleiche Referenz → eigene Buchung
select public.upsert_booking('{
  "external_ref": "CSV-1", "customer_name": "Andere", "plate": "X 1",
  "start_at": "2030-05-01T06:00:00Z", "end_at": "2030-05-02T06:00:00Z", "parking_type": "outdoor"
}'::jsonb, 'portal_x') as r4 \gset
select pg_temp.assert_eq((:'r4'::jsonb) ->> 'action', 'created', 'Idempotenz je Quelle');

-- Manuell ohne Referenz → immer neu
select public.upsert_booking('{
  "customer_name": "Walk-in", "plate": "M 1", "start_at": "2030-05-01T06:00:00Z",
  "end_at": "2030-05-02T06:00:00Z", "parking_type": "outdoor_cover"
}'::jsonb) as r5 \gset
select pg_temp.assert_eq((:'r5'::jsonb) ->> 'action', 'created', 'manuell angelegt');


-- Neue Felder + individuelle Preise/Beschreibungen
select public.upsert_booking('{
  "external_ref": "XL-7", "customer_name": "Firma Test", "company": "Test AG", "plate": "M-AB 1234",
  "start_at": "2030-06-01T06:00:00+02:00", "end_at": "2030-06-03T20:00:00+02:00", "parking_type": "outdoor",
  "return_mode": "pickup_delivery", "price_total": 149.5, "payment_status": "partial", "fuel_type": "electric",
  "received_at": "2030-05-20T09:00:00+02:00",
  "services": [{"code": "ZUSATZ", "price": 45.5, "description": "Dachbox"}, "LADEN"]
}'::jsonb, 'excel') as x1 \gset
select (:'x1'::jsonb) ->> 'id' as xid \gset
select pg_temp.assert_eq((select row(company, return_mode, price_total, payment_status, fuel_type)::text
  from public.bookings where id = :'xid'), '("Test AG",pickup_delivery,149.50,partial,electric)', 'neue Felder');
select pg_temp.assert_eq((select price_at_booking::text || '|' || bs.description from public.booking_services bs
  join public.services s on s.id = bs.service_id where bs.booking_id = :'xid' and s.code = 'ZUSATZ'),
  '45.50|Dachbox', 'individueller Preis + Beschreibung');
select pg_temp.assert_eq((select jsonb_array_length(checklist) from public.tasks t join public.services s on s.id = t.service_id
  where t.booking_id = :'xid' and s.code = 'LADEN'), 3, 'Teilschritte aus Katalog als Checkliste');
-- Re-Import ohne Preis überschreibt den vereinbarten Preis nicht
select public.upsert_booking('{"external_ref": "XL-7", "services": ["ZUSATZ", "LADEN"]}'::jsonb, 'excel') as x2 \gset
select pg_temp.assert_eq((:'x2'::jsonb) ->> 'action', 'unchanged', 'Re-Import ohne Änderung');
select pg_temp.assert_eq((select price_at_booking from public.booking_services bs
  join public.services s on s.id = bs.service_id where bs.booking_id = :'xid' and s.code = 'ZUSATZ'),
  45.50::numeric, 'Preis bleibt erhalten');
-- Zahlungsstatus-Änderung landet in der Historie
select public.upsert_booking('{"external_ref": "XL-7", "payment_status": "paid"}'::jsonb, 'excel') as x3 \gset
select pg_temp.assert_eq((:'x3'::jsonb) ->> 'action', 'updated', 'Zahlungsstatus geändert');


-- Bearbeiten per id (manuelle Buchung ohne Buchungs-Nr.)
select (:'r5'::jsonb) ->> 'id' as mid \gset
select public.upsert_booking(jsonb_build_object('id', :'mid', 'plate', 'M-NE 1', 'external_ref', 'NEU-1',
  'services', jsonb_build_array('POLITUR')), 'manual') as e1 \gset
select pg_temp.assert_eq((:'e1'::jsonb) ->> 'action', 'updated', 'per id bearbeitet');
select pg_temp.assert_eq((select plate || '|' || external_ref from public.bookings where id = :'mid'), 'M-NE 1|NEU-1',
  'Kennzeichen und Buchungs-Nr. geändert');
do $$
begin
  perform public.upsert_booking('{"id": "00000000-0000-0000-0000-000000000000", "plate": "X"}'::jsonb);
  raise exception 'FEHLER: unbekannte id akzeptiert';
exception when no_data_found then null;
end;
$$;

-- Storno per Import
select public.upsert_booking('{"external_ref": "CSV-1", "cancelled": true}'::jsonb, 'csv');
select pg_temp.assert_eq((select status from public.bookings where id = :'bid'), 'cancelled', 'storniert');
select pg_temp.assert_eq(
  (select count(*)::int from public.tasks where booking_id = :'bid' and status in ('open', 'in_progress')), 0,
  'offene Aufgaben storniert');

-- Inaktives Konto darf nicht importieren
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'inaktiv@example.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$
begin
  perform public.upsert_booking('{"customer_name": "x"}'::jsonb);
  raise exception 'FEHLER: inaktives Konto konnte importieren';
exception when insufficient_privilege then null;
end;
$$;

reset role;
reset request.jwt.claim.sub;
\o
\echo '  ✓ 20_upsert_booking'
