-- Aushilfen per QR-Code freischalten (0.40.0)
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000098001', 'personal@example.com'),
  ('00000000-0000-0000-0000-000000098002', 'fahrer@example.com'),
  ('00000000-0000-0000-0000-000000098003', null),
  ('00000000-0000-0000-0000-000000098004', null);
update public.profiles set active = true, roles = array['staff'] where id = '00000000-0000-0000-0000-000000098001';
update public.profiles set active = true, roles = array['driver'] where id = '00000000-0000-0000-0000-000000098002';

-- 1) Reiner Fahrer darf nicht freischalten
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000098002';
do $$
begin
  perform public.create_helper_invite('Max Aushilfe');
  raise exception 'FEHLER: Fahrer darf nicht freischalten';
exception when insufficient_privilege then null;
end;
$$;

-- 2) Personal erzeugt einen Code
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000098001';
select public.create_helper_invite('Max Aushilfe') as inv \gset
select (:'inv'::jsonb) ->> 'code' as code \gset
select pg_temp.assert_eq(length(:'code'), 64, 'Code 64 Hex');
select set_config('test.code', :'code', false);
select pg_temp.assert_eq(((:'inv'::jsonb) ->> 'access_until')::timestamptz, public.berlin_end_of_day(), 'bis Tagesende');
do $$
begin
  perform public.create_helper_invite(' ');
  raise exception 'FEHLER: leerer Name';
exception when invalid_parameter_value then null;
end;
$$;
-- Codes sind nicht direkt lesbar
do $$
begin
  perform 1 from public.helper_invites;
  raise exception 'FEHLER: helper_invites lesbar';
exception when insufficient_privilege then null;
end;
$$;

-- 3) Echtes (nicht anonymes) Konto kann den Code nicht einlösen
set request.jwt.claims = '{"is_anonymous": false}';
do $$
begin
  perform public.redeem_helper_invite(current_setting('test.code'));
  raise exception 'FEHLER: echtes Konto eingelöst';
exception when insufficient_privilege then null;
end;
$$;

-- 4) Anonymes Gerät löst ein → Aushilfe bis Tagesende
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000098003';
set request.jwt.claims = '{"is_anonymous": true}';
select pg_temp.assert_eq(public.is_staff(), false, 'vor dem Einlösen kein Zugriff');
select public.redeem_helper_invite(upper(:'code'));
select pg_temp.assert_eq(public.is_staff(), true, 'Aushilfe hat Zugriff');
select pg_temp.assert_eq(public.is_personnel(), false, 'Aushilfe ist kein festes Personal');
reset role;
select pg_temp.assert_eq((select roles from public.profiles where id = '00000000-0000-0000-0000-000000098003'), array['helper'], 'Rolle helper');
select pg_temp.assert_eq((select display_name from public.profiles where id = '00000000-0000-0000-0000-000000098003'), 'Max Aushilfe', 'Name');
select pg_temp.assert_eq((select role from public.profiles where id = '00000000-0000-0000-0000-000000098003'), 'staff', 'abgeleitete Spalte role');

-- 5) Code nur einmal
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000098004';
do $$
begin
  perform public.redeem_helper_invite(current_setting('test.code'));
  raise exception 'FEHLER: Code zweimal eingelöst';
exception when raise_exception then
  if sqlerrm not like 'Freischalt-Code%' then raise; end if;
end;
$$;

-- 6) Aushilfe darf keine weiteren Aushilfen freischalten
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000098003';
do $$
begin
  perform public.create_helper_invite('Noch jemand');
  raise exception 'FEHLER: Aushilfe darf nicht freischalten';
exception when insufficient_privilege then null;
end;
$$;

-- 7) Liste und Sperren durch Personal
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000098001';
select pg_temp.assert_eq((select count(*)::int from public.list_helpers() where id = '00000000-0000-0000-0000-000000098003'), 1, 'in der Liste');
select public.revoke_helper('00000000-0000-0000-0000-000000098003');
select pg_temp.assert_eq((select count(*)::int from public.list_helpers()), 0, 'nach Sperren nicht mehr gelistet');
-- Sperren trifft nie festes Personal
select public.revoke_helper('00000000-0000-0000-0000-000000098002');
reset role;
select pg_temp.assert_eq((select active from public.profiles where id = '00000000-0000-0000-0000-000000098002'), true, 'Fahrer bleibt aktiv');

-- 8) Abgelaufener Zugang zählt nicht
update public.profiles set active = true, access_until = now() - interval '1 minute'
where id = '00000000-0000-0000-0000-000000098003';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000098003';
select pg_temp.assert_eq(public.is_staff(), false, 'abgelaufen');
select pg_temp.assert_eq(public.is_member(), false, 'abgelaufen (Mitglied)');
reset role;
reset request.jwt.claim.sub;
reset request.jwt.claims;

\o
\echo '  ✓ 99_helper_access'
