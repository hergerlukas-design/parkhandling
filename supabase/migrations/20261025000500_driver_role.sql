-- =============================================================================
-- 0.27.0 Rolle „Fahrer“ und Mehrfachrollen (Entscheidung Lukas 25.10.2026)
--
--   * profiles.roles text[]: beliebige Kombination aus admin, staff, driver
--     (profiles.role bleibt als abgeleitete Spalte für ältere App-Versionen und
--     wird in beide Richtungen synchron gehalten: admin in roles ⇔ role = 'admin')
--   * Rechte: admin ⊃ staff (alles). Reiner Fahrer sieht nur die Shuttle-Ansicht:
--     Fahrten lesen, Status und Fahrer setzen, eigene Push-Geräte verwalten.
--     Buchungen, Lageplan, Aufgaben usw. bleiben per RLS gesperrt.
--   * Benachrichtigungen: Empfänger je Ereignis als Rollenliste (Mehrfachauswahl).
--     'staff' = Personal und Admins, 'admin' = nur Admins, 'driver' = Fahrer.
-- Additiv und abwärtskompatibel.
-- =============================================================================

-- 1) Rollen ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists roles text[] not null default '{staff}';

update public.profiles
set roles = case when role = 'admin' then array['admin'] else array['staff'] end
where roles = '{staff}' and role = 'admin';

alter table public.profiles drop constraint if exists profiles_roles_check;
alter table public.profiles
  add constraint profiles_roles_check
  check (cardinality(roles) >= 1 and roles <@ array['admin', 'staff', 'driver']);

create index if not exists profiles_roles_idx on public.profiles using gin (roles);

-- role ⇔ roles synchron halten (läuft vor guard_last_admin: Name sortiert zuerst)
create or replace function public.sync_profile_roles()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.role = 'admin' and not ('admin' = any (new.roles)) then
      new.roles := array['admin'];
    end if;
  elsif new.roles is distinct from old.roles then
    null; -- roles ist führend
  elsif new.role is distinct from old.role then
    -- ältere App ändert nur role
    if new.role = 'admin' then
      new.roles := array(select distinct r from unnest(new.roles || array['admin']) r order by 1);
    else
      new.roles := array_remove(new.roles, 'admin');
      if cardinality(new.roles) = 0 then
        new.roles := array['staff'];
      end if;
    end if;
  end if;
  new.roles := array(select distinct r from unnest(new.roles) r order by 1);
  new.role := case when 'admin' = any (new.roles) then 'admin' else 'staff' end;
  return new;
end;
$$;

drop trigger if exists profiles_a_sync_roles on public.profiles;
create trigger profiles_a_sync_roles
  before insert or update on public.profiles
  for each row execute function public.sync_profile_roles();

-- Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden
create or replace function public.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if 'admin' = any (old.roles) and old.active
     and (not ('admin' = any (new.roles)) or not new.active) then
    if not exists (
      select 1 from public.profiles
       where 'admin' = any (roles) and active and id <> old.id
    ) then
      raise exception 'Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_profile_roles() from public, anon, authenticated;

-- 2) Rechte ---------------------------------------------------------------------
-- Aktives Konto (jede Rolle)
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

-- Personal: staff oder admin (reine Fahrer nicht)
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and roles && array['admin', 'staff']
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and 'admin' = any (roles))
$$;

create or replace function public.is_driver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and 'driver' = any (roles))
$$;

revoke execute on function public.is_member(), public.is_driver() from public, anon;
grant execute on function public.is_member(), public.is_driver() to authenticated;

-- Fahrer: Fahrten lesen (auch Realtime) und Status/Fahrer setzen
drop policy if exists driver_select on public.transport_jobs;
create policy driver_select on public.transport_jobs
  for select to authenticated using ((select public.is_driver()));
drop policy if exists driver_update on public.transport_jobs;
create policy driver_update on public.transport_jobs
  for update to authenticated
  using ((select public.is_driver())) with check ((select public.is_driver()));

-- Push-Einstellungen lesen (Geräte-Anmeldung) für alle aktiven Konten
drop policy if exists member_select_push on public.settings;
create policy member_select_push on public.settings
  for select to authenticated
  using ((select public.is_member()) and key in ('notifications', 'push_vapid_public_key', 'shuttle_capacity'));

-- Eigene Push-Geräte für alle aktiven Konten
drop policy if exists own_select on public.push_subscriptions;
create policy own_select on public.push_subscriptions
  for select to authenticated
  using ((select public.is_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));
drop policy if exists own_update on public.push_subscriptions;
create policy own_update on public.push_subscriptions
  for update to authenticated
  using ((select public.is_member()) and (user_id = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));
drop policy if exists own_delete on public.push_subscriptions;
create policy own_delete on public.push_subscriptions
  for delete to authenticated
  using ((select public.is_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));

-- 3) Benachrichtigungen ------------------------------------------------------------
-- Rollen eines Kontos für Ereignis-Empfänger: admin zählt auch als staff
create or replace function public.notify_roles(p_roles text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select case when 'admin' = any (p_roles) then p_roles || array['staff'] else p_roles end
$$;

-- Vorbelegung neuer Geräte: Ereignisse, deren Empfänger-Rollen zum Konto passen
create or replace function public.default_push_events(p_roles text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.key order by e.key), '{}')
  from jsonb_each(coalesce(public.notification_settings() -> 'events', '{}'::jsonb)) e
  where coalesce((e.value ->> 'enabled')::boolean, true)
    and array(select jsonb_array_elements_text(coalesce(e.value -> 'roles', '["staff"]'))) && public.notify_roles(p_roles)
$$;

-- alte Signatur (ein Rollenname) bleibt für ältere Aufrufer
create or replace function public.default_push_events(p_role text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select public.default_push_events(array[coalesce(p_role, 'staff')])
$$;

revoke execute on function public.default_push_events(text[]) from public, anon;

create or replace function public.notification_recipients(n public.notifications)
returns setof public.push_subscriptions
language sql
stable
security definer
set search_path = public
as $$
  select s.*
  from public.push_subscriptions s
  join public.profiles p on p.id = s.user_id
  where s.active
    and p.active
    and s.user_id is distinct from n.exclude_user_id
    and case
      when n.target_subscription_id is not null then s.id = n.target_subscription_id
      when n.target_user_id is not null then s.user_id = n.target_user_id and n.event = any (s.events)
      else n.event = any (s.events) and public.notify_roles(p.roles) && n.target_roles
    end
$$;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text default '',
  p_device_id text default null,
  p_user_agent text default null,
  p_events text[] default null
)
returns public.push_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_roles text[];
  v_row public.push_subscriptions;
  v_known text[] := array(select jsonb_object_keys(public.notification_settings() -> 'events'));
begin
  if not public.is_member() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select roles into v_roles from public.profiles where id = v_uid;
  insert into public.push_subscriptions (
    user_id, device_id, device_label, endpoint, p256dh, auth, user_agent, events
  )
  values (
    v_uid, p_device_id, left(coalesce(btrim(p_device_label), ''), 60), p_endpoint, p_p256dh, p_auth,
    left(p_user_agent, 500),
    case
      when p_events is null then public.default_push_events(v_roles)
      else array(select distinct e from unnest(p_events) e where e = any (v_known) order by 1)
    end
  )
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    device_id = excluded.device_id,
    device_label = case when excluded.device_label <> '' then excluded.device_label else push_subscriptions.device_label end,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    events = case
      when p_events is not null or push_subscriptions.user_id <> excluded.user_id then excluded.events
      else push_subscriptions.events
    end,
    active = true,
    failure_count = 0,
    last_error = null
  returning * into v_row;
  if p_device_id is not null then
    update public.push_subscriptions
    set active = false
    where device_id = p_device_id and id <> v_row.id and active;
  end if;
  return v_row;
end;
$$;

create or replace function public.set_push_events(p_endpoint text, p_events text[])
returns public.push_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.push_subscriptions;
  v_known text[] := array(select jsonb_object_keys(public.notification_settings() -> 'events'));
begin
  if not public.is_member() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  update public.push_subscriptions
  set events = array(select distinct e from unnest(coalesce(p_events, '{}')) e where e = any (v_known) order by 1)
  where endpoint = p_endpoint and user_id = auth.uid()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

-- Shuttle fällig: zusätzlich an Fahrer (eingeteilter Fahrer bekommt es ohnehin direkt)
update public.settings
set value = jsonb_set(value, '{events,shuttle_due,roles}', '["driver", "staff"]')
where key = 'notifications'
  and value #> '{events,shuttle_due,roles}' = '["staff"]'::jsonb;

update public.settings
set description = 'Push-Benachrichtigungen: Ereignisse an/aus, Empfänger-Rollen (staff = Personal inkl. Admins, admin = nur Admins, driver = Fahrer; mehrere möglich), Vorlaufzeiten in Minuten'
where key = 'notifications';

-- 4) Shuttle-Ansicht für Fahrer ------------------------------------------------------
-- Fahrerauswahl: Konten mit Rolle Fahrer; gibt es noch keine, alle aktiven Konten
create or replace function public.list_drivers()
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name from public.profiles p
  where p.active and public.is_member()
    and ('driver' = any (p.roles)
         or not exists (select 1 from public.profiles d where d.active and 'driver' = any (d.roles)))
  order by p.display_name
$$;


-- Testbenachrichtigung auch für Fahrer
create or replace function public.send_test_push(p_endpoint text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.push_subscriptions;
  v_id uuid;
begin
  if not public.is_member() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select * into v_sub from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid() and active;
  if v_sub.id is null then
    raise exception 'Dieses Gerät ist nicht für Benachrichtigungen angemeldet' using errcode = 'P0002';
  end if;

  insert into public.notifications (event, ref_type, dedupe_key, payload, target_subscription_id)
  values (
    'test', 'push_subscription', 'test:' || v_sub.id || ':' || gen_random_uuid(),
    jsonb_build_object(
      'title', 'Testbenachrichtigung',
      'body', 'Benachrichtigungen funktionieren auf diesem Gerät.',
      'url', '/einstellungen',
      'tag', 'test',
      'event', 'test'
    ),
    v_sub.id
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Dispo-/Fahreransicht für alle aktiven Konten (Fahrer eingeschlossen)
create or replace function public.transport_board(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  type text,
  direction text,
  scheduled_at timestamptz,
  status text,
  driver_id uuid,
  driver_name text,
  meeting_point text,
  note text,
  persons integer,
  capacity integer,
  passengers jsonb,
  driver_shuttle_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.type, j.direction, j.scheduled_at, j.status, j.driver_id, d.display_name,
         j.meeting_point, j.note,
         coalesce(sum(p.persons) filter (where b.status <> 'cancelled'), 0)::integer,
         coalesce((public.get_setting('shuttle_capacity', '8') #>> '{}')::integer, 8),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'booking_id', b.id,
           'persons', p.persons,
           'manual', p.manual,
           'plate', b.plate,
           'vehicle_model', b.vehicle_model,
           'customer_name', b.customer_name,
           'customer_phone', b.customer_phone,
           'customer_language', b.customer_language,
           'flight', x.flight,
           'terminal', public.terminal_for_flight(x.flight),
           'start_at', b.start_at,
           'return_flight_at', b.return_flight_at,
           'end_at', b.end_at,
           'parking_type', b.parking_type,
           'booking_status', b.status
         ) order by b.plate) filter (where p.id is not null), '[]'::jsonb),
         case when j.type = 'pickup_delivery' then public.valet_driver_shuttle_at(j.direction, j.scheduled_at) end
  from public.transport_jobs j
  left join public.profiles d on d.id = j.driver_id
  left join public.transport_passengers p on p.transport_job_id = j.id
  left join public.bookings b on b.id = p.booking_id
  -- Hinweg-Flug: Shuttle zum Flughafen bzw. Hol- & Bring-Übernahme; sonst Rückflug
  left join lateral (
    select case when (j.direction = 'to_airport') <> (j.type = 'pickup_delivery') then b.flight_out else b.flight_return end as flight
  ) x on true
  where public.is_member()
    and j.scheduled_at >= p_from and j.scheduled_at < p_to
  group by j.id, d.display_name
  order by j.scheduled_at, j.direction
$$;

revoke execute on function public.transport_board(timestamptz, timestamptz) from public, anon;
grant execute on function public.transport_board(timestamptz, timestamptz) to authenticated;
