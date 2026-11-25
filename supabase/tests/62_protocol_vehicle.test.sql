-- Protokoll: Kennzeichen und Antrieb gehen in die Buchung (0.42.0)
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000062001', 'pv@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-000000062001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000062001';

select public.upsert_booking(jsonb_build_object('external_ref', 'PV-1', 'customer_name', 'PV Kunde', 'plate', 'M-PV 1',
  'start_at', now(), 'end_at', now() + interval '3 days', 'parking_type', 'outdoor'), 'protokolltest') ->> 'id' as bid \gset

-- Entwurf mit Kennzeichen wie in der Buchung und ohne Antrieb: Buchung bleibt
insert into public.protocols (booking_id, type, inspector_name, plate)
values (:'bid', 'intake', 'Mitarbeiter', 'M-PV 1') returning id as pid \gset
select pg_temp.assert_eq((select count(*)::int from public.booking_history where booking_id = :'bid' and source = 'protocol'), 0, 'keine Änderung');

-- Kennzeichen korrigiert und Antrieb gewählt → Buchung übernimmt beides, Historie mit Quelle protocol
update public.protocols set plate = ' m-pv  2 ', fuel_type = 'hybrid' where id = :'pid';
select pg_temp.assert_eq((select plate from public.bookings where id = :'bid'), 'M-PV 2', 'Kennzeichen übernommen (normalisiert)');
select pg_temp.assert_eq((select fuel_type from public.bookings where id = :'bid'), 'hybrid', 'Antrieb übernommen');
select pg_temp.assert_eq((select count(*)::int from public.booking_history where booking_id = :'bid' and source = 'protocol'
  and changed_fields ? 'plate' and changed_fields ? 'fuel_type'), 1, 'Historie');

-- Leeres Kennzeichen ändert die Buchung nicht
update public.protocols set plate = '' where id = :'pid';
select pg_temp.assert_eq((select plate from public.bookings where id = :'bid'), 'M-PV 2', 'leer ändert nichts');

-- Ladestand 0–100, Antrieb nur bekannte Werte
update public.protocols set charge_level = 0 where id = :'pid';
do $$
begin
  update public.protocols set charge_level = 101 where inspector_name = 'Mitarbeiter' and plate = '';
  raise exception 'FEHLER: Ladestand 101';
exception when check_violation then null;
end;
$$;
do $$
begin
  update public.protocols set fuel_type = 'diesel' where inspector_name = 'Mitarbeiter' and plate = '';
  raise exception 'FEHLER: unbekannter Antrieb';
exception when check_violation then null;
end;
$$;

reset role;
reset request.jwt.claim.sub;
\o
\echo '  ✓ 62_protocol_vehicle'
