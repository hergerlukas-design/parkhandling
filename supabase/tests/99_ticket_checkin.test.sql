-- Kunden-QR-Code (Check-in-Ticket) und Check-in-Stand von CarHandling (0.39.0)
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

set role service_role;
set request.jwt.claim.role = 'service_role';

create temp table t1 as select jsonb_build_object(
  'source', 'carhandling', 'external_ref', 'PH301201-OEC-SH-001', 'event', 'change', 'tariff_code', 'economy',
  'checkin_token', '0123456789ABCDEF0123456789abcdef',
  'checked_in_at', null,
  'raw', jsonb_build_object('booking_ref', 'PH301201-OEC-SH-001'),
  'booking', jsonb_build_object('customer_name', 'Ticket Test', 'plate', 'M-TI 1',
    'start_at', '2030-12-01T09:00:00Z', 'end_at', '2030-12-07T11:00:00Z', 'payment_status', 'paid')) as p;

-- 1) Neu: Ticket-Code als Hash gespeichert, nicht im Klartext
select public.sync_external_booking((select p from t1)) as r1 \gset
select (:'r1'::jsonb) ->> 'booking_id' as bid \gset
select pg_temp.assert_eq((select checkin_token_hash from public.bookings where id = :'bid'),
  public.ticket_hash('0123456789abcdef0123456789abcdef'), 'Hash gespeichert (Kleinschreibung)');
select pg_temp.assert_eq(length((select checkin_token_hash from public.bookings where id = :'bid')), 64, 'SHA-256 hex');
select pg_temp.assert_eq((select carhandling_checked_in_at from public.bookings where id = :'bid'), null::timestamptz, 'noch nicht angenommen');

-- 2) Wiederholung: unverändert
select public.sync_external_booking((select p from t1)) as r2 \gset
select pg_temp.assert_eq((:'r2'::jsonb) ->> 'status', 'unchanged', 'Wiederholung unverändert');

-- 3) Check-in bei CarHandling → übernommen, zählt als Änderung
update t1 set p = jsonb_set(p, '{checked_in_at}', '"2030-12-01T09:12:00Z"');
select public.sync_external_booking((select p from t1)) as r3 \gset
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'status', 'updated', 'Check-in ist Änderung');
select pg_temp.assert_eq((select carhandling_checked_in_at from public.bookings where id = :'bid'),
  '2030-12-01T09:12:00Z'::timestamptz, 'Check-in übernommen');

-- 4) Ohne die Felder im Datensatz bleibt der Stand
update t1 set p = (p - 'checked_in_at') - 'checkin_token';
select public.sync_external_booking((select p from t1)) as r4 \gset
select pg_temp.assert_eq((:'r4'::jsonb) ->> 'status', 'unchanged', 'fehlende Felder ändern nichts');
select pg_temp.assert_eq((select carhandling_checked_in_at from public.bookings where id = :'bid'),
  '2030-12-01T09:12:00Z'::timestamptz, 'Check-in bleibt');

-- 5) Zurückgenommen (null) → geleert
update t1 set p = p || '{"checked_in_at": null}'::jsonb;
select public.sync_external_booking((select p from t1));
select pg_temp.assert_eq((select carhandling_checked_in_at from public.bookings where id = :'bid'), null::timestamptz, 'Check-in zurückgenommen');

reset role;
reset request.jwt.claim.role;

-- 6) Suche per Scan: nur Mitarbeitende
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000099001', 'ticketstaff@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-000000099001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000099001';

select pg_temp.assert_eq((public.find_booking_by_scan('https://parkhandling-rechner.pplx.app/ticket.html#0123456789abcdef0123456789abcdef') ->> 'id'),
  :'bid', 'Ticket-Link gefunden');
select pg_temp.assert_eq((public.find_booking_by_scan('0123456789ABCDEF0123456789ABCDEF') ->> 'id'), :'bid', 'reiner Code gefunden');
select pg_temp.assert_eq((public.find_booking_by_scan(' ph301201-oec-sh-001 ') ->> 'id'), :'bid', 'Buchungsnummer gefunden');
select pg_temp.assert_eq((public.find_booking_by_scan('PH301201-OEC-SH-001') ->> 'intake_final')::boolean, false, 'Annahme offen');
select pg_temp.assert_eq(public.find_booking_by_scan('ffffffffffffffffffffffffffffffff'), null::jsonb, 'unbekannter Code');
select pg_temp.assert_eq(public.find_booking_by_scan(''), null::jsonb, 'leer');

reset role;
reset request.jwt.claim.sub;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000099002', 'inactive@example.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000099002';
do $$
begin
  perform public.find_booking_by_scan('PH301201-OEC-SH-001');
  raise exception 'FEHLER: inaktive Nutzer dürfen nicht suchen';
exception when insufficient_privilege then null;
end;
$$;
reset role;
reset request.jwt.claim.sub;

-- 7) Nachtrag aus der Notiz (Logik der Migration)
update public.bookings set checkin_token_hash = null,
  notes = 'Check-in-Ticket: https://parkhandling-rechner.pplx.app/ticket.html#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
where id = :'bid';
update public.bookings
set checkin_token_hash = public.ticket_hash(substring(notes from 'ticket\.html#([0-9a-fA-F]{32})'))
where source = 'carhandling' and checkin_token_hash is null and notes ~ 'ticket\.html#[0-9a-fA-F]{32}';
select pg_temp.assert_eq((select checkin_token_hash from public.bookings where id = :'bid'),
  public.ticket_hash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'Nachtrag aus Notiz');

\o
\echo '  ✓ 99_ticket_checkin'
