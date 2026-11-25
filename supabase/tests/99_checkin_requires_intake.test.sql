-- Einchecken erst nach abgeschlossenem Annahmeprotokoll (0.45.0): move_vehicle sperrt die erste Platzierung
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

create or replace function pg_temp.error_of(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e5', 'einchecken@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000e5';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e5';

select public.upsert_booking(jsonb_build_object('external_ref', 'CI-1', 'customer_name', 'Check-in', 'plate', 'M-CI 1',
  'start_at', now(), 'end_at', now() + interval '5 days', 'parking_type', 'outdoor'), 'checkintest') ->> 'id' as bid \gset
select code as spot from public.location_board
where area in ('outdoor_a', 'outdoor_b') and occupancy < capacity order by code limit 1 \gset
select code as spot2 from public.location_board
where area in ('outdoor_a', 'outdoor_b') and occupancy < capacity and code <> :'spot' order by code limit 1 \gset

-- Ohne Protokoll: gesperrt, nichts bewegt
select pg_temp.assert_eq(pg_temp.error_of(format('select public.move_vehicle(%L, %L)', :'bid', :'spot')),
  'Parken von M-CI 1 erst nach abgeschlossenem Annahmeprotokoll', 'ohne Protokoll gesperrt');
select pg_temp.assert_eq((select current_location_id is null and status = 'booked' from public.bookings where id = :'bid'), true,
  'Buchung unverändert');

-- Entwurf reicht nicht
insert into public.protocols (booking_id, type, status) values (:'bid', 'intake', 'draft');
select pg_temp.assert_eq(pg_temp.error_of(format('select public.move_vehicle(%L, %L)', :'bid', :'spot')),
  'Parken von M-CI 1 erst nach abgeschlossenem Annahmeprotokoll', 'Entwurf reicht nicht');

-- Übergabeprotokoll zählt nicht als Annahme
insert into public.protocols (booking_id, type, status) values (:'bid', 'handover', 'final');
select pg_temp.assert_eq(pg_temp.error_of(format('select public.move_vehicle(%L, %L)', :'bid', :'spot')),
  'Parken von M-CI 1 erst nach abgeschlossenem Annahmeprotokoll', 'Übergabeprotokoll zählt nicht');
-- Abgeschlossen: Einchecken klappt (Pflichtangaben beim Abschließen prüft ein anderer Test, hier direkt final)
reset role;
delete from public.protocols where booking_id = :'bid';
insert into public.protocols (booking_id, type, status) values (:'bid', 'intake', 'final');
set role authenticated;
select public.move_vehicle(:'bid', :'spot', 'Einlagern');
select pg_temp.assert_eq((select status from public.bookings where id = :'bid'), 'stored', 'eingecheckt nach Protokoll');

-- Umsetzen eines stehenden Fahrzeugs bleibt möglich
select public.move_vehicle(:'bid', :'spot2', 'Umsetzen');
select pg_temp.assert_eq((select l.code from public.bookings b join public.locations l on l.id = b.current_location_id
  where b.id = :'bid'), :'spot2', 'Umsetzen weiter möglich');

\o
\echo '  ✓ 99_checkin_requires_intake'
