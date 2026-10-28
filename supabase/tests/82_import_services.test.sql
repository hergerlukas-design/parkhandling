-- Parkos-Import: Zusatzleistungen aus der Mail werden ergänzt und erzeugen Aufgaben (0.31.0)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b3', 'importsvc@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000b3';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b3';

create temp table mail as select jsonb_build_object(
  'source', 'parkos', 'mail_type', 'new', 'raw_text', 'x',
  'services', jsonb_build_array(jsonb_build_object('code', 'LADEN', 'price', 10, 'description', 'E-Ladeservice'),
                                jsonb_build_object('code', 'GIBTSNICHT', 'price', 5)),
  'booking', jsonb_build_object('external_ref', 'SVC01', 'customer_name', 'Svc Test', 'plate', 'M-SV 1',
    'start_at', '2030-11-01T10:00:00+01:00', 'end_at', '2030-11-05T19:00:00+01:00', 'parking_type', 'outdoor')) as p;

select public.import_booking_mail((select p from mail)) as r1 \gset
select (:'r1'::jsonb) ->> 'booking_id' as bid \gset
select pg_temp.assert_eq((:'r1'::jsonb) ->> 'status', 'imported', 'angelegt');
select pg_temp.assert_eq((:'r1'::jsonb) -> 'added_services', '["LADEN"]'::jsonb, 'LADEN ergänzt');
select pg_temp.assert_eq((select bs.price_at_booking from public.booking_services bs join public.services s on s.id = bs.service_id
  where bs.booking_id = :'bid' and s.code = 'LADEN'), 10::numeric, 'Preis');
select pg_temp.assert_eq((select count(*)::int from public.tasks where booking_id = :'bid' and type = 'charge' and status = 'open'), 1, 'Ladeaufgabe');

-- Erneuter Import: nichts doppelt
select public.import_booking_mail((select p from mail)) as r2 \gset
select pg_temp.assert_eq((:'r2'::jsonb) ->> 'status', 'unchanged', 'unverändert');
select pg_temp.assert_eq((select count(*)::int from public.tasks where booking_id = :'bid' and type = 'charge'), 1, 'keine zweite Aufgabe');

-- Von Hand storniert → erneuter Import holt sie nicht zurück; andere Leistungen bleiben
select public.upsert_booking(jsonb_build_object('id', :'bid', 'services', jsonb_build_array('AUF_INNEN')), 'manual');
select public.import_booking_mail((select p from mail));
select pg_temp.assert_eq((select bs.status from public.booking_services bs join public.services s on s.id = bs.service_id
  where bs.booking_id = :'bid' and s.code = 'LADEN'), 'cancelled', 'Storno bleibt');
select pg_temp.assert_eq((select bs.status from public.booking_services bs join public.services s on s.id = bs.service_id
  where bs.booking_id = :'bid' and s.code = 'AUF_INNEN'), 'active', 'Hand-Leistung bleibt');

-- Umbuchung mit neuem E-Ladeservice → Leistung ergänzt, Umbuchung übernommen
select public.upsert_booking(jsonb_build_object('external_ref', 'SVC02', 'customer_name', 'Umbuchung', 'plate', 'M-SV 2',
  'start_at', '2030-11-01T10:00:00+01:00', 'end_at', '2030-11-05T19:00:00+01:00', 'parking_type', 'outdoor'), 'parkos') ->> 'id' as bid2 \gset
select public.import_booking_mail(jsonb_set(jsonb_set((select p from mail), '{mail_type}', '"change"'),
  '{booking,external_ref}', '"SVC02"')) as r3 \gset
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'status', 'updated', 'Umbuchung übernommen');
select pg_temp.assert_eq((:'r3'::jsonb) ->> 'booking_id', :'bid2', 'Umbuchung verweist auf Buchung');
select pg_temp.assert_eq((select count(*)::int from public.tasks where booking_id = :'bid2' and type = 'charge' and status = 'open'), 1, 'Ladeaufgabe nach Umbuchung');

-- Nur über import_booking_mail aufrufbar
do $$
begin
  perform public.add_import_services(gen_random_uuid(), '[]'::jsonb);
  raise exception 'FEHLER: direkt aufrufbar';
exception when insufficient_privilege then null;
end;
$$;
reset role;

\o
\echo '  ✓ 82_import_services'
