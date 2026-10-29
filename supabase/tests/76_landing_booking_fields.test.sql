-- Online-Buchungen in der App: Tarif an der Buchung, im Tarif enthaltene Leistungen werden gebucht
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

begin;

-- Edge Function legt eine Premium-Buchung an
set role service_role;
insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type, tariff_code)
values ('landing', 'T-PREMIUM', 'Test', 'M-LP 1', '2030-04-01 08:00+02', '2030-04-08 08:00+02', 'indoor', 'premium');
reset role;

select pg_temp.assert_eq(
  (select array_agg(s.code order by s.code) from public.booking_services bs
   join public.services s on s.id = bs.service_id
   join public.bookings b on b.id = bs.booking_id where b.external_ref = 'T-PREMIUM'),
  array['GRUND', 'SERVICE'], 'Premium: Standard + Servicearbeit');
select pg_temp.assert_eq(
  (select bs.description like 'Tarif Premium:%' from public.booking_services bs
   join public.services s on s.id = bs.service_id
   join public.bookings b on b.id = bs.booking_id where b.external_ref = 'T-PREMIUM' and s.code = 'SERVICE'),
  true, 'Beschreibung aus dem Tarif');
select pg_temp.assert_eq(
  (select count(*) from public.tasks t join public.bookings b on b.id = t.booking_id
   where b.external_ref = 'T-PREMIUM' and t.type = 'service'),
  2::bigint, 'Aufgaben für beide Leistungen');

-- Economy hat keine Zusatzleistung; Buchung ohne Tarif ebenso
insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type, tariff_code)
values ('landing', 'T-ECONOMY', 'Test', 'M-LP 2', '2030-04-01 08:00+02', '2030-04-08 08:00+02', 'outdoor', 'economy');
select pg_temp.assert_eq(
  (select count(*) from public.booking_services bs join public.bookings b on b.id = bs.booking_id
   where b.external_ref = 'T-ECONOMY'),
  1::bigint, 'Economy: nur Standard');

-- Unbekannter Code im Tarif wird übergangen
update public.booking_tariffs set included_services = '[{"code": "GIBTESNICHT"}]' where code = 'business';
insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type, tariff_code)
values ('landing', 'T-BUSINESS', 'Test', 'M-LP 3', '2030-04-01 08:00+02', '2030-04-08 08:00+02', 'indoor', 'business');
select pg_temp.assert_eq(
  (select count(*) from public.booking_services bs join public.bookings b on b.id = bs.booking_id
   where b.external_ref = 'T-BUSINESS'),
  1::bigint, 'unbekannter Code ohne Fehler');

-- Übernahme alter Notizen (wie die Migration): Tarif und Flugnummern
insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type, notes)
values ('landing', 'T-ALT', 'Test', 'M-LP 4', '2030-04-01 08:00+02', '2030-04-08 08:00+02', 'outdoor_cover',
  E'Tarif: Space\nFlug Hinflug: LH 1234 · Rückflug: –\nKindersitze: 0 · Gepäckstücke: 1');
update public.bookings b set tariff_code = t.code
from public.booking_tariffs t
where b.external_ref = 'T-ALT'
  and split_part(b.notes, E'\n', 1) in ('Tarif: ' || t.label, case t.code when 'space' then 'Tarif: Space' end);
update public.bookings b
set flight_out = coalesce(b.flight_out, nullif(m[1], '–')), flight_return = coalesce(b.flight_return, nullif(m[2], '–'))
from (select id, regexp_match(notes, 'Flug Hinflug: ([^\n·]+?) · Rückflug: ([^\n]+)') as m from public.bookings where external_ref = 'T-ALT') f
where f.id = b.id and f.m is not null;
select pg_temp.assert_eq((select tariff_code from public.bookings where external_ref = 'T-ALT'), 'space', 'alter Name Space');
select pg_temp.assert_eq((select flight_out from public.bookings where external_ref = 'T-ALT'), 'LH 1234', 'Flug hin');
select pg_temp.assert_eq((select flight_return from public.bookings where external_ref = 'T-ALT'), null::text, 'Flug zurück leer');

-- Personal liest den Tarif
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000076a1', 'tarif@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000076a1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000076a1';
select pg_temp.assert_eq((select label from public.booking_tariffs where code = 'premium'), 'Premium', 'Personal sieht Tarif');
select pg_temp.assert_eq((select count(*) from public.booking_withdrawals), 0::bigint, 'Personal liest Widerrufe');
reset role;

rollback;

\o
\echo '  ✓ 76_landing_booking_fields'
