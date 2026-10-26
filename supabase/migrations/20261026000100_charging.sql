-- =============================================================================
-- 0.29.0 Laden erfassen (Kempower ChargEye)
--
-- Ablauf:
--   1. Personal öffnet die Aufgabe „Laden“ und scannt den QR-Aufkleber am Ladepunkt
--      (PF-CHG:<Code>). start_charging() legt eine Sitzung an:
--        * Provider kempower + API an → Status waiting, die Edge Function charging-sync sucht
--          die Transaktion am Connector und übernimmt sie (charging → ended).
--        * Provider manual oder API aus → Status manual, Werte werden in der App eingetragen.
--   2. charging_dispatch() stößt charging-sync per pg_net an (sofort nach dem Scan und per
--      pg_cron jede Minute, gedrosselt auf settings.charging.poll_interval_minutes).
--   3. charging-sync meldet jede Transaktion mit charging_apply() zurück. Bei Ladeende werden
--      kWh, SoC und Ende festgeschrieben, optional die Aufgabe abgeschlossen und der Push
--      charging_ended ausgelöst.
--
-- Der QR-Code auf dem Kempower-Display (kempower.io/c/<uuid>) ist ein Token pro Ladevorgang
-- und wird nicht ausgewertet (Test 26.10.2026).
--
-- Abrechnung: Standard pauschal über die Leistung „Laden“. Pro kWh nur mit eichrechtskonformer
-- Messung (charge_points.legal_metering) und Wert aus der API (apply_charging_price).
--
-- Secrets im Vault: kempower_refresh_token, charging_sync_url, charging_sync_secret.
-- Rein additiv: alte App-Versionen arbeiten unverändert weiter (Abschnitt 6, Punkt 7).
-- =============================================================================

-- 1) Einstellungen -------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('charging', '{
      "provider": "manual",
      "api_enabled": false,
      "api_base_url": "https://kempower.io/api",
      "poll_interval_minutes": 5,
      "link_window_minutes": 15,
      "billing_mode": "flat",
      "price_per_kwh": null,
      "auto_complete_task": false
   }',
   'Laden: Provider (manual/kempower), API an/aus, Abfrageintervall und Zuordnungsfenster in Minuten, Abrechnung (flat = Pauschale über die Leistung „Laden“, per_kwh = Preis pro kWh), Aufgabe bei Ladeende automatisch abschließen')
on conflict (key) do nothing;

-- Neues Push-Ereignis „Ladung beendet“ (bestehende Einstellungen bleiben erhalten)
update public.settings
set value = jsonb_set(value, '{events,charging_ended}', '{"enabled": true, "roles": ["staff"]}'::jsonb, true)
where key = 'notifications' and not coalesce(value -> 'events' ? 'charging_ended', false);

-- Geräte, die „Fahrzeug bereit“ bekommen, bekommen auch „Ladung beendet“
update public.push_subscriptions
set events = array(select distinct e from unnest(events || array['charging_ended']) e order by 1)
where active and 'booking_ready' = any (events) and not ('charging_ended' = any (events));

-- 2) Tabellen ----------------------------------------------------------------------------
create table if not exists public.charge_points (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  label text,
  location_id uuid references public.locations (id) on delete set null,
  provider text not null default 'manual' check (provider in ('manual', 'kempower')),
  station_id text check (length(station_id) <= 100),
  connector_id text check (length(connector_id) <= 100),
  qr_code text not null unique,
  legal_metering boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.charge_points is 'Ladepunkte (je Stecker/Connector) mit eigenem QR-Aufkleber PF-CHG:<code>';
comment on column public.charge_points.legal_metering is 'Eichrechtskonforme Messung vorhanden – Voraussetzung für Abrechnung pro kWh';

create table if not exists public.charging_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  charge_point_id uuid not null references public.charge_points (id),
  provider text not null check (provider in ('manual', 'kempower')),
  external_tx_id text,
  status text not null check (status in ('waiting', 'charging', 'ended', 'failed', 'manual')),
  source text not null check (source in ('api', 'manual')),
  linked_by uuid references auth.users (id) on delete set null,
  linked_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  energy_kwh numeric(10, 3) check (energy_kwh >= 0),
  soc_start smallint check (soc_start between 0 and 100),
  soc_end smallint check (soc_end between 0 and 100),
  power_kw numeric(6, 1),
  max_power_kw numeric(6, 1),
  end_reason text check (length(end_reason) <= 300),
  raw jsonb,
  last_polled_at timestamptz,
  billing_mode text check (billing_mode in ('flat', 'per_kwh')),
  price_per_kwh numeric(8, 4),
  amount numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.charging_sessions is 'Ladevorgänge je Buchung/Aufgabe; wächst stetig → später nach created_at archivieren';

-- Eine Transaktion hängt nie an zwei Buchungen, ein Ladepunkt hat höchstens eine offene Sitzung
create unique index if not exists charging_sessions_tx_uidx
  on public.charging_sessions (provider, external_tx_id) where external_tx_id is not null;
create unique index if not exists charging_sessions_open_point_uidx
  on public.charging_sessions (charge_point_id) where status in ('waiting', 'charging', 'manual');
create unique index if not exists charging_sessions_open_task_uidx
  on public.charging_sessions (task_id) where status in ('waiting', 'charging', 'manual');
create index if not exists charging_sessions_booking_idx on public.charging_sessions (booking_id);
create index if not exists charging_sessions_open_idx on public.charging_sessions (status)
  where status in ('waiting', 'charging');
create index if not exists charging_sessions_linked_by_idx on public.charging_sessions (linked_by);
create index if not exists charge_points_location_idx on public.charge_points (location_id);

-- Zustand der Schnittstelle (eine Zeile): Token-Cache, letzter Abruf, Stationsliste
create table if not exists public.charging_sync_state (
  id smallint primary key default 1 check (id = 1),
  access_token text,
  token_valid_until timestamptz,
  last_dispatch_at timestamptz,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  stations jsonb not null default '[]'::jsonb,
  test_requested_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.charging_sync_state (id) values (1) on conflict (id) do nothing;

create trigger set_updated_at before update on public.charge_points
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.charging_sessions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.charging_sync_state
  for each row execute function public.set_updated_at();

alter table public.charge_points enable row level security;
alter table public.charging_sessions enable row level security;
alter table public.charging_sync_state enable row level security;

create policy staff_select on public.charge_points
  for select to authenticated using ((select public.is_staff()));
create policy admin_insert on public.charge_points
  for insert to authenticated with check ((select public.is_admin()));
create policy admin_update on public.charge_points
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_delete on public.charge_points
  for delete to authenticated using ((select public.is_admin()));

-- Sitzungen lesen: Personal; ändern nur über die Funktionen unten
create policy staff_select on public.charging_sessions
  for select to authenticated using ((select public.is_staff()));

grant select, insert, update, delete on public.charge_points to authenticated;
grant select on public.charging_sessions to authenticated;
grant all on public.charge_points, public.charging_sessions, public.charging_sync_state to service_role;
revoke all on public.charge_points, public.charging_sessions, public.charging_sync_state from anon;
revoke all on public.charging_sync_state from authenticated;

-- 3) Seed: Ladepunkte an den Ladeplätzen -------------------------------------------------
insert into public.charge_points (code, label, location_id, provider, qr_code, sort_order)
select v.code, v.label, l.id, 'manual', 'PF-CHG:' || v.code, v.sort_order
from (values ('LP1', 'Ladeplatz 1', 'W-LAD1', 10), ('LP2', 'Ladeplatz 2', 'W-LAD2', 20)) v(code, label, loc, sort_order)
left join public.locations l on l.code = v.loc
on conflict (code) do nothing;

-- 4) Hilfsfunktionen ------------------------------------------------------------------------
create or replace function public.charging_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select '{
      "provider": "manual", "api_enabled": false, "api_base_url": "https://kempower.io/api",
      "poll_interval_minutes": 5, "link_window_minutes": 15, "billing_mode": "flat",
      "price_per_kwh": null, "auto_complete_task": false
    }'::jsonb || coalesce(public.get_setting('charging'), '{}'::jsonb)
$$;

-- kWh deutsch formatiert, eine Nachkommastelle (für Push-Texte)
create or replace function public.charging_kwh_label(p_kwh numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_kwh is null then '– kWh'
    else replace(to_char(round(p_kwh, 1), 'FM99990.0'), '.', ',') || ' kWh' end
$$;

-- Scan → Ladepunkt: PF-CHG:LP1, LP1 (Groß-/Kleinschreibung egal)
create or replace function public.charge_point_by_scan(p_code text)
returns public.charge_points
language sql
stable
security definer
set search_path = public
as $$
  select cp.* from public.charge_points cp
  where cp.active
    and (upper(cp.qr_code) = upper(btrim(p_code))
      or cp.code = upper(regexp_replace(btrim(p_code), '^PF-CHG:', '', 'i')))
  limit 1
$$;

-- Aufgabe abschließen, wenn eingestellt; Push „Ladung beendet“ (nur bei Werten aus der API)
create or replace function public.charging_after_end(p_session public.charging_sessions, p_notify boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := public.charging_settings();
  v_plate text;
  v_code text;
begin
  if coalesce((v_cfg ->> 'auto_complete_task')::boolean, false) and p_session.task_id is not null then
    update public.tasks set status = 'done'
    where id = p_session.task_id and status in ('open', 'in_progress');
  end if;
  if p_notify then
    select b.plate into v_plate from public.bookings b where b.id = p_session.booking_id;
    select cp.code into v_code from public.charge_points cp where cp.id = p_session.charge_point_id;
    perform public.enqueue_notification(
      'charging_ended', 'charging_session', p_session.id, 'charging_ended:' || p_session.id,
      'Ladung beendet: ' || coalesce(v_plate, 'Fahrzeug'),
      coalesce(v_code, 'Ladepunkt') || ' · ' || public.charging_kwh_label(p_session.energy_kwh)
        || coalesce(' · ' || p_session.soc_end || ' %', ''),
      case when p_session.task_id is not null then '/aufgaben?aufgabe=' || p_session.task_id
        else '/fahrzeuge/' || p_session.booking_id end
    );
  end if;
end;
$$;

-- 5) App-Funktionen (Personal) ----------------------------------------------------------------
create or replace function public.start_charging(p_task_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := public.charging_settings();
  t public.tasks;
  b public.bookings;
  cp public.charge_points;
  v_busy text;
  v_session public.charging_sessions;
  v_api boolean;
  v_hint jsonb;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if p_code ~* '^https?://([a-z0-9-]+\.)*kempower\.(io|com)/c/' then
    raise exception 'Das ist der Code vom Display der Ladesäule. Bitte den Aufkleber am Ladepunkt scannen.'
      using errcode = 'P0001';
  end if;

  select * into t from public.tasks where id = p_task_id for update;
  if t.id is null or t.type <> 'charge' then
    raise exception 'Keine Ladeaufgabe' using errcode = 'P0002';
  end if;
  if t.status in ('done', 'cancelled') then
    raise exception 'Die Aufgabe ist bereits abgeschlossen' using errcode = 'P0001';
  end if;
  select * into b from public.bookings where id = t.booking_id;
  if b.status in ('completed', 'cancelled') then
    raise exception 'Buchung ist % – keine Ladung möglich',
      case b.status when 'cancelled' then 'storniert' else 'abgeschlossen' end using errcode = 'P0001';
  end if;

  cp := public.charge_point_by_scan(p_code);
  if cp.id is null then
    raise exception '„%“ ist kein Ladepunkt', btrim(p_code) using errcode = 'P0002';
  end if;

  if exists (select 1 from public.charging_sessions
             where task_id = t.id and status in ('waiting', 'charging', 'manual')) then
    raise exception 'Für diese Aufgabe ist bereits eine Ladung offen' using errcode = 'P0001';
  end if;
  select bb.plate into v_busy
  from public.charging_sessions s join public.bookings bb on bb.id = s.booking_id
  where s.charge_point_id = cp.id and s.status in ('waiting', 'charging', 'manual');
  if v_busy is not null then
    raise exception 'Ladepunkt % ist belegt (%). Dort erst die Ladung beenden oder trennen.', cp.code, v_busy
      using errcode = 'P0001';
  end if;

  v_api := cp.provider <> 'manual' and coalesce((v_cfg ->> 'api_enabled')::boolean, false);

  insert into public.charging_sessions (
    booking_id, task_id, charge_point_id, provider, status, source, linked_by, linked_at
  ) values (
    t.booking_id, t.id, cp.id, cp.provider,
    case when v_api then 'waiting' else 'manual' end,
    case when v_api then 'api' else 'manual' end,
    auth.uid(), now()
  )
  returning * into v_session;

  if t.status = 'open' then
    update public.tasks set status = 'in_progress' where id = t.id;
  end if;

  -- Steht das Fahrzeug nicht am Ladeplatz des Ladepunkts? → Hinweis zum Umbuchen
  if cp.location_id is not null and b.current_location_id is distinct from cp.location_id then
    select jsonb_build_object('code', l.code, 'name', l.name) into v_hint
    from public.locations l where l.id = cp.location_id;
  end if;

  if v_api then
    perform public.charging_dispatch(true);
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'charge_point_code', cp.code,
    'location_hint', v_hint
  );
end;
$$;

-- Werte von Hand eintragen (manueller Modus oder wenn die Säule nichts geliefert hat)
create or replace function public.save_manual_charging(
  p_session_id uuid,
  p_energy_kwh numeric,
  p_started_at timestamptz default null,
  p_ended_at timestamptz default null,
  p_soc_start smallint default null,
  p_soc_end smallint default null
)
returns public.charging_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.charging_sessions;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select * into s from public.charging_sessions where id = p_session_id for update;
  if s.id is null then
    raise exception 'Ladung nicht gefunden' using errcode = 'P0002';
  end if;
  if s.source = 'api' and s.status in ('charging', 'ended') then
    raise exception 'Die Werte dieser Ladung kommen aus der Ladesäule' using errcode = 'P0001';
  end if;
  if p_energy_kwh is null or p_energy_kwh < 0 or p_energy_kwh > 500 then
    raise exception 'Energie bitte zwischen 0 und 500 kWh angeben' using errcode = '22023';
  end if;
  if p_soc_start is not null and (p_soc_start < 0 or p_soc_start > 100)
     or p_soc_end is not null and (p_soc_end < 0 or p_soc_end > 100) then
    raise exception 'Ladestand bitte zwischen 0 und 100 %% angeben' using errcode = '22023';
  end if;
  if p_started_at is not null and p_ended_at is not null and p_ended_at < p_started_at then
    raise exception 'Ende liegt vor dem Beginn' using errcode = '22023';
  end if;

  update public.charging_sessions set
    status = 'ended',
    source = 'manual',
    external_tx_id = null,
    energy_kwh = round(p_energy_kwh, 3),
    started_at = coalesce(p_started_at, started_at, linked_at),
    ended_at = coalesce(p_ended_at, ended_at, now()),
    soc_start = p_soc_start,
    soc_end = p_soc_end,
    end_reason = case when s.source = 'api' then 'Von Hand eingetragen (Säule lieferte keine Werte)' else 'Von Hand eingetragen' end
  where id = s.id
  returning * into s;

  perform public.charging_after_end(s, false);
  return s;
end;
$$;

-- Falsch gescannt / abbrechen: Verknüpfung lösen, Sitzung bleibt als „getrennt“ erhalten
create or replace function public.cancel_charging(p_session_id uuid, p_reason text default null)
returns public.charging_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.charging_sessions;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select * into s from public.charging_sessions where id = p_session_id for update;
  if s.id is null then
    raise exception 'Ladung nicht gefunden' using errcode = 'P0002';
  end if;
  if s.status = 'failed' then
    return s;
  end if;
  update public.charging_sessions set
    status = 'failed',
    end_reason = left('Getrennt' || coalesce(': ' || nullif(btrim(p_reason), ''), '')
      || coalesce(' (Transaktion ' || external_tx_id || ')', ''), 300),
    external_tx_id = null
  where id = s.id
  returning * into s;
  return s;
end;
$$;

-- Abrechnung pro kWh in die Leistung „Laden“ der Buchung übernehmen
create or replace function public.apply_charging_price(p_session_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb := public.charging_settings();
  s public.charging_sessions;
  cp public.charge_points;
  t public.tasks;
  v_price numeric;
  v_amount numeric(10, 2);
  v_desc text;
  v_bs_id uuid;
  v_old numeric;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if coalesce(v_cfg ->> 'billing_mode', 'flat') <> 'per_kwh' then
    raise exception 'Abrechnung ist auf Pauschale eingestellt' using errcode = 'P0001';
  end if;
  v_price := nullif(v_cfg ->> 'price_per_kwh', '')::numeric;
  if v_price is null or v_price <= 0 then
    raise exception 'Kein Preis pro kWh hinterlegt (Einstellungen → Laden)' using errcode = 'P0001';
  end if;

  select * into s from public.charging_sessions where id = p_session_id for update;
  if s.id is null then
    raise exception 'Ladung nicht gefunden' using errcode = 'P0002';
  end if;
  if s.status <> 'ended' or s.energy_kwh is null then
    raise exception 'Die Ladung ist noch nicht beendet' using errcode = 'P0001';
  end if;
  select * into cp from public.charge_points where id = s.charge_point_id;
  if not cp.legal_metering or s.source <> 'api' then
    raise exception 'Abrechnung pro kWh nur mit eichrechtskonformer Messung' using errcode = 'P0001';
  end if;

  v_amount := round(s.energy_kwh * v_price, 2);
  v_desc := replace(to_char(round(s.energy_kwh, 3), 'FM99990.000'), '.', ',') || ' kWh à '
    || replace(to_char(v_price, 'FM990.00'), '.', ',') || ' €';

  select * into t from public.tasks where id = s.task_id;
  v_bs_id := t.booking_service_id;
  if v_bs_id is null then
    select bs.id into v_bs_id
    from public.booking_services bs join public.services sv on sv.id = bs.service_id
    where bs.booking_id = s.booking_id and sv.category = 'charge' and bs.status = 'active'
    order by bs.created_at limit 1;
  end if;
  if v_bs_id is null then
    raise exception 'Die Buchung hat keine Leistung „Laden“' using errcode = 'P0001';
  end if;

  select price_at_booking into v_old from public.booking_services where id = v_bs_id;
  update public.booking_services set price_at_booking = v_amount, description = v_desc where id = v_bs_id;
  update public.charging_sessions set billing_mode = 'per_kwh', price_per_kwh = v_price, amount = v_amount
  where id = s.id;

  insert into public.booking_history (booking_id, changed_fields, source, changed_by)
  values (
    s.booking_id,
    jsonb_build_object('charging_price', jsonb_build_object('old', v_old, 'new', v_amount, 'description', v_desc)),
    'charging',
    auth.uid()
  );
  return v_amount;
end;
$$;

-- Status der Schnittstelle für die App (ohne Token)
create or replace function public.charging_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st public.charging_sync_state;
  v_has_token boolean := false;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select * into st from public.charging_sync_state where id = 1;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select exists (select 1 from vault.decrypted_secrets
      where name = 'kempower_refresh_token' and coalesce(decrypted_secret, '') <> '')$q$ into v_has_token;
  end if;
  return jsonb_build_object(
    'api_enabled', coalesce((public.charging_settings() ->> 'api_enabled')::boolean, false),
    'refresh_token_in_vault', v_has_token,
    'last_sync_at', st.last_sync_at,
    'last_success_at', st.last_success_at,
    'last_error', st.last_error,
    'test_requested_at', st.test_requested_at,
    'stations', coalesce(st.stations, '[]'::jsonb)
  );
end;
$$;

-- Admin: „Verbindung testen“ – Abruf sofort anstoßen, Ergebnis über charging_status()
create or replace function public.request_charging_test()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins' using errcode = '42501';
  end if;
  update public.charging_sync_state set test_requested_at = now() where id = 1;
  return public.charging_dispatch(true);
end;
$$;

-- 6) Abruf (Edge Function charging-sync, nur service_role) -------------------------------------
-- Wartende Sitzungen ohne Treffer nach dem Zeitfenster → fehlgeschlagen
create or replace function public.charging_expire_waiting(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.charging_sessions
  set status = 'failed',
      end_reason = 'Keine Ladung erkannt – Werte bitte von Hand eintragen'
  where status = 'waiting'
    and linked_at < p_now - make_interval(mins => greatest(1,
      coalesce((public.charging_settings() ->> 'link_window_minutes')::integer, 15)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Stößt charging-sync an, wenn es etwas abzufragen gibt (gedrosselt auf das Abfrageintervall).
-- Ohne pg_net oder Vault-Einträge passiert nichts.
create or replace function public.charging_dispatch(p_force boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.charging_sync_state;
  v_interval integer := greatest(1, coalesce((public.charging_settings() ->> 'poll_interval_minutes')::integer, 5));
  v_url text;
  v_secret text;
begin
  perform public.charging_expire_waiting();
  select * into st from public.charging_sync_state where id = 1 for update;

  if not exists (select 1 from public.charging_sessions where status in ('waiting', 'charging') and source = 'api')
     and st.test_requested_at is null then
    return false;
  end if;
  if not p_force and st.last_dispatch_at is not null
     and st.last_dispatch_at > now() - make_interval(mins => v_interval) + interval '20 seconds' then
    return false;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return false;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'charging_sync_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'charging_sync_secret'$q$ into v_secret;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return false;
  end if;
  update public.charging_sync_state set last_dispatch_at = now() where id = 1;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 20000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-charging-secret', v_secret);
  return true;
exception when others then
  raise warning 'Lade-Abruf nicht angestoßen: %', sqlerrm;
  return false;
end;
$$;

-- Konfiguration für die Edge Function: Refresh-Token, gecachtes JWT, Einstellungen
create or replace function public.charging_sync_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st public.charging_sync_state;
  v_refresh text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'kempower_refresh_token'$q$ into v_refresh;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'charging_sync_secret'$q$ into v_secret;
  end if;
  select * into st from public.charging_sync_state where id = 1;
  return jsonb_build_object(
    'settings', public.charging_settings(),
    'refresh_token', coalesce(v_refresh, ''),
    'secret', coalesce(v_secret, ''),
    'access_token', case when st.token_valid_until > now() + interval '5 minutes' then st.access_token end,
    'test_requested', st.test_requested_at is not null
  );
end;
$$;

create or replace function public.charging_store_token(p_token text, p_valid_until timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.charging_sync_state set access_token = p_token, token_valid_until = p_valid_until where id = 1
$$;

-- Offene Sitzungen mit Station/Connector für den Abruf
create or replace function public.charging_open_sessions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'status', s.status,
    'external_tx_id', s.external_tx_id,
    'linked_at', s.linked_at,
    'station_id', cp.station_id,
    'connector_id', cp.connector_id,
    'charge_point_code', cp.code
  ) order by s.linked_at), '[]'::jsonb)
  from public.charging_sessions s
  join public.charge_points cp on cp.id = s.charge_point_id
  where s.status in ('waiting', 'charging') and s.source = 'api'
$$;

-- Ergebnis eines Abrufs für eine Sitzung. p_tx (normalisiert, siehe _shared/kempower.ts):
--   {tx_id, state: charging|ended, started_at, ended_at, energy_kwh, soc_start, soc, power_kw, end_reason, raw}
-- Rückgabe: linked | updated | ended | taken | ignored
create or replace function public.charging_apply(p_session_id uuid, p_tx jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.charging_sessions;
  v_tx text := nullif(p_tx ->> 'tx_id', '');
  v_state text := coalesce(p_tx ->> 'state', 'charging');
  v_result text := 'updated';
begin
  select * into s from public.charging_sessions where id = p_session_id for update;
  if s.id is null or s.status not in ('waiting', 'charging') or s.source <> 'api' or v_tx is null then
    return 'ignored';
  end if;
  if s.status = 'charging' and s.external_tx_id is distinct from v_tx then
    return 'ignored';
  end if;
  if s.status = 'waiting' then
    if exists (select 1 from public.charging_sessions
               where provider = s.provider and external_tx_id = v_tx and id <> s.id) then
      return 'taken';
    end if;
    v_result := 'linked';
  end if;

  update public.charging_sessions set
    external_tx_id = v_tx,
    status = case when v_state = 'ended' then 'ended' else 'charging' end,
    started_at = coalesce(nullif(p_tx ->> 'started_at', '')::timestamptz, started_at),
    ended_at = case when v_state = 'ended'
      then coalesce(nullif(p_tx ->> 'ended_at', '')::timestamptz, now()) else null end,
    energy_kwh = coalesce(nullif(p_tx ->> 'energy_kwh', '')::numeric, energy_kwh),
    soc_start = coalesce(nullif(p_tx ->> 'soc_start', '')::numeric::smallint, soc_start),
    soc_end = coalesce(nullif(p_tx ->> 'soc', '')::numeric::smallint, soc_end),
    power_kw = case when v_state = 'ended' then null else nullif(p_tx ->> 'power_kw', '')::numeric end,
    max_power_kw = greatest(max_power_kw, nullif(p_tx ->> 'power_kw', '')::numeric),
    end_reason = case when v_state = 'ended' then left(p_tx ->> 'end_reason', 300) else end_reason end,
    raw = p_tx -> 'raw',
    last_polled_at = now()
  where id = s.id
  returning * into s;

  if v_state = 'ended' then
    perform public.charging_after_end(s, true);
    return 'ended';
  end if;
  return v_result;
end;
$$;

create or replace function public.charging_sync_finished(p_ok boolean, p_error text default null, p_stations jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.charging_sync_state set
    last_sync_at = now(),
    last_success_at = case when p_ok then now() else last_success_at end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    stations = coalesce(p_stations, stations),
    test_requested_at = null
  where id = 1;
  perform public.charging_expire_waiting();
end;
$$;

-- 7) Übersicht für die App ------------------------------------------------------------------
create or replace view public.charging_session_board
with (security_invoker = true)
as
select
  s.*,
  cp.code as charge_point_code,
  cp.label as charge_point_label,
  cp.legal_metering,
  b.plate,
  t.status as task_status,
  nullif(p.display_name, '') as linked_by_name
from public.charging_sessions s
join public.charge_points cp on cp.id = s.charge_point_id
join public.bookings b on b.id = s.booking_id
left join public.tasks t on t.id = s.task_id
left join public.profiles p on p.id = s.linked_by;

grant select on public.charging_session_board to authenticated;

-- 8) Rechte ------------------------------------------------------------------------------------
revoke execute on function
  public.charging_settings(),
  public.charging_kwh_label(numeric),
  public.charge_point_by_scan(text),
  public.charging_after_end(public.charging_sessions, boolean),
  public.charging_expire_waiting(timestamptz),
  public.charging_dispatch(boolean),
  public.charging_sync_config(),
  public.charging_store_token(text, timestamptz),
  public.charging_open_sessions(),
  public.charging_apply(uuid, jsonb),
  public.charging_sync_finished(boolean, text, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.charging_dispatch(boolean),
  public.charging_sync_config(),
  public.charging_store_token(text, timestamptz),
  public.charging_open_sessions(),
  public.charging_apply(uuid, jsonb),
  public.charging_sync_finished(boolean, text, jsonb),
  public.charging_expire_waiting(timestamptz)
  to service_role;

revoke execute on function
  public.start_charging(uuid, text),
  public.save_manual_charging(uuid, numeric, timestamptz, timestamptz, smallint, smallint),
  public.cancel_charging(uuid, text),
  public.apply_charging_price(uuid),
  public.charging_status(),
  public.request_charging_test()
  from public, anon;
grant execute on function
  public.start_charging(uuid, text),
  public.save_manual_charging(uuid, numeric, timestamptz, timestamptz, smallint, smallint),
  public.cancel_charging(uuid, text),
  public.apply_charging_price(uuid),
  public.charging_status(),
  public.request_charging_test()
  to authenticated;

-- 9) Zeitplan (nur wenn pg_cron vorhanden) ------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('charging-sync', '* * * * *', 'select public.charging_dispatch()');
  end if;
end;
$$;
