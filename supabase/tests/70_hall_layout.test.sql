-- Halle umstellen (0.21.0): set_hall_layout legt Plätze an, (de)aktiviert sie und schützt belegte Plätze
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

-- Liefert die Fehlermeldung eines Aufrufs (null, wenn er durchläuft)
create or replace function pg_temp.error_of(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'halle-admin@example.com'),
  ('00000000-0000-0000-0000-0000000000a8', 'halle-personal@example.com');
update public.profiles set active = true, role = 'admin' where id = '00000000-0000-0000-0000-0000000000a7';
update public.profiles set active = true, role = 'staff' where id = '00000000-0000-0000-0000-0000000000a8';
set role authenticated;

-- Personal darf nicht umstellen
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a8';
select pg_temp.assert_eq(pg_temp.error_of('select public.set_hall_layout(4, 2)'), 'Nur Admins können die Halle umstellen',
  'Personal darf die Halle nicht umstellen');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
select pg_temp.assert_eq(pg_temp.error_of('select public.set_hall_layout(4, 9)'), 'Ebenen: 1 bis 5 erlaubt', 'Ebenen begrenzt');

-- Belegte Plätze (Demo-Daten in R5–R8) verhindern das Verkleinern, nichts wird geändert
select pg_temp.assert_eq(pg_temp.error_of('select public.set_hall_layout(4, 2)') like 'Erst umsetzen bzw. freigeben: %', true,
  'belegte Plätze sperren die Umstellung');
select pg_temp.assert_eq((select count(*)::int from public.location_board where area = 'hall'), 24, 'Halle unverändert 8 × 3');

-- Vergrößern auf 9 × 4: 12 neue Plätze, alle aktiv und im Lageplan
select pg_temp.assert_eq(public.set_hall_layout(9, 4) ->> 'created', '12', '12 Plätze angelegt');
select pg_temp.assert_eq((select count(*)::int from public.location_board where area = 'hall'), 36, 'Halle 9 × 4');
select pg_temp.assert_eq((select qr_code from public.locations where code = 'R9-E4'), 'PF-LOC:R9-E4', 'QR-Code für neuen Platz');

-- Zurück auf 8 × 3: neue Plätze werden deaktiviert, nicht gelöscht
select pg_temp.assert_eq(public.set_hall_layout(8, 3) ->> 'deactivated', '12', '12 Plätze deaktiviert');
select pg_temp.assert_eq((select count(*)::int from public.locations where area = 'hall'), 36, 'Plätze bleiben gespeichert');
select pg_temp.assert_eq((select count(*)::int from public.location_board where area = 'hall'), 24, 'Lageplan zeigt 8 × 3');
select pg_temp.assert_eq(pg_temp.error_of(
  'select public.move_vehicle((select id from public.bookings where status not in (''completed'', ''cancelled'') limit 1), ''R9-E1'')'),
  'Platz R9-E1 ist deaktiviert', 'deaktivierter Platz nicht belegbar');

-- Erneut vergrößern aktiviert die vorhandenen Plätze wieder
select pg_temp.assert_eq(public.set_hall_layout(9, 4) - 'racks' - 'levels', '{"created": 0, "activated": 12, "deactivated": 0}'::jsonb,
  'vorhandene Plätze reaktiviert');
select public.set_hall_layout(8, 3);

reset role;
\o
\echo '  ✓ 70_hall_layout'
