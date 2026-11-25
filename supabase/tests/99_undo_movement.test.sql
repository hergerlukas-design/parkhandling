-- Letzte Bewegung rückgängig machen (0.39.0)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d9', 'undo@example.com')
on conflict do nothing;
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000d9';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d9';

-- zwei freie Außenplätze
select code as p1 from public.locations l
where l.area in ('outdoor_a', 'outdoor_b') and l.active and l.status = 'free'
order by l.code limit 1 \gset
select code as p2 from public.locations l
where l.area in ('outdoor_a', 'outdoor_b') and l.active and l.status = 'free' and l.code <> :'p1'
order by l.code limit 1 \gset

select public.upsert_booking(jsonb_build_object('external_ref', 'UNDO-1', 'customer_name', 'Rück Gängig',
  'plate', 'M-UN 1', 'start_at', now() + interval '1 day', 'end_at', now() + interval '5 days',
  'parking_type', 'outdoor'), 'undotest');
select id as b1 from public.bookings where external_ref = 'UNDO-1' \gset

-- 1. Einlagern → rückgängig: kein Platz, Status wieder „Gebucht“, Platz frei
select public.move_vehicle(:'b1', :'p1', 'Einlagern');
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'stored', 'eingelagert');
select id as m1 from public.vehicle_movements where booking_id = :'b1' \gset

select public.undo_last_movement(:'b1', :'m1');
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'booked', 'Status zurück auf Gebucht');
select pg_temp.assert_eq((select current_location_id from public.bookings where id = :'b1'), null::uuid, 'kein Platz mehr');
select pg_temp.assert_eq((select count(*)::int from public.vehicle_movements where booking_id = :'b1'), 0, 'Bewegung gelöscht');
select pg_temp.assert_eq((select status from public.locations where code = :'p1'), 'free', 'Platz wieder frei');
select pg_temp.assert_eq((select count(*)::int from public.booking_history
  where booking_id = :'b1' and changed_fields ? 'movement_undone'), 1, 'Rücknahme in der Historie');

-- 2. Umsetzen → rückgängig: wieder auf dem alten Platz, Status bleibt eingelagert
select public.move_vehicle(:'b1', :'p1', 'Einlagern');
select public.move_vehicle(:'b1', :'p2', 'Umsetzen');
select id as m2 from public.vehicle_movements where booking_id = :'b1' order by moved_at desc, created_at desc limit 1 \gset

-- nur die letzte Bewegung
do $$
begin
  perform public.undo_last_movement((select id from public.bookings where external_ref = 'UNDO-1'),
    (select m.id from public.vehicle_movements m join public.bookings b on b.id = m.booking_id
     where b.external_ref = 'UNDO-1' order by m.moved_at, m.created_at limit 1));
  raise exception 'FEHLER: ältere Bewegung wurde zurückgenommen';
exception when sqlstate 'P0001' then null;
end;
$$;

select public.undo_last_movement(:'b1', :'m2');
select pg_temp.assert_eq((select l.code from public.bookings b join public.locations l on l.id = b.current_location_id
  where b.id = :'b1'), :'p1', 'wieder auf dem alten Platz');
select pg_temp.assert_eq((select status from public.bookings where id = :'b1'), 'stored', 'Status bleibt eingelagert');
select pg_temp.assert_eq((select status from public.locations where code = :'p2'), 'free', 'Zielplatz wieder frei');

-- 3. Übergabe lässt sich nicht zurücknehmen (Buchung abgeschlossen)
select public.move_vehicle(:'b1', null, 'Übergeben');
do $$
begin
  perform public.undo_last_movement((select id from public.bookings where external_ref = 'UNDO-1'),
    (select m.id from public.vehicle_movements m join public.bookings b on b.id = m.booking_id
     where b.external_ref = 'UNDO-1' order by m.moved_at desc, m.created_at desc limit 1));
  raise exception 'FEHLER: Übergabe wurde zurückgenommen';
exception when sqlstate 'P0001' then null;
end;
$$;

reset role;
