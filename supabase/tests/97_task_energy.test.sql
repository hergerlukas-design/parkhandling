-- Ladeaufgabe: geladene kWh beim Abschließen (0.30.0)
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

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e7', 'laden@example.com', '{"name": "Mitarbeiter Laden"}');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000e7';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e7';

select public.upsert_booking(jsonb_build_object('external_ref', 'KWH-1', 'customer_name', 'Laden', 'plate', 'M-KW 1',
  'start_at', now(), 'end_at', now() + interval '3 days', 'parking_type', 'outdoor', 'services', jsonb_build_array('LADEN')), 'kwhtest') ->> 'id' as bid \gset
select id as tid from public.tasks where booking_id = :'bid' and type = 'charge' \gset

-- Personal schließt mit kWh ab
update public.tasks set status = 'in_progress' where id = :'tid';
update public.tasks set status = 'done', energy_kwh = 23.4 where id = :'tid';
select pg_temp.assert_eq((select energy_kwh from public.tasks where id = :'tid'), 23.4::numeric, 'kWh gespeichert');
select pg_temp.assert_eq((select status from public.tasks where id = :'tid'), 'done', 'erledigt');

-- Mehrere Ladevorgänge (Abbruch, neu angesteckt)
update public.tasks set energy_parts = '[{"kwh": 3.1, "at": "2026-10-26T10:00:00Z"}, {"kwh": 22.5, "at": "2026-10-26T11:00:00Z"}]', energy_kwh = 25.6 where id = :'tid';
select pg_temp.assert_eq((select jsonb_array_length(energy_parts) from public.tasks where id = :'tid'), 2, 'zwei Ladevorgänge');
select pg_temp.assert_eq((select energy_parts from public.tasks t where t.type = 'service' limit 1), '[]'::jsonb, 'Standard leer');
do $$
begin
  update public.tasks set energy_parts = '{"kwh": 1}' where type = 'charge' and energy_kwh is not null;
  raise exception 'FEHLER: Objekt statt Liste angenommen';
exception when check_violation then null;
end;
$$;

-- Werte außerhalb 0–500 werden abgelehnt
do $$
begin
  update public.tasks set energy_kwh = 600 where type = 'charge' and energy_kwh is not null;
  raise exception 'FEHLER: 600 kWh angenommen';
exception when check_violation then null;
end;
$$;

\o
\echo '  ✓ 97_task_energy'
