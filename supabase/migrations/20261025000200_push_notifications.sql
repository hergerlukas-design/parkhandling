-- =============================================================================
-- 0.25.0 Push-Benachrichtigungen für das Personal (Web Push, VAPID)
--
-- Ablauf:
--   1. Trigger und der Zeitplan (pg_cron) legen Einträge in `notifications` an (Outbox).
--      Doppelte Meldungen verhindert `dedupe_key` (on conflict do nothing).
--   2. `dispatch_push()` stößt per pg_net die Edge Function `push-send` an (nach dem Commit).
--      Ein Cron-Lauf jede Minute holt liegengebliebene Einträge nach.
--   3. `push-send` holt sich mit `claim_push_batch()` Meldung + Empfänger, verschlüsselt und
--      sendet sie und meldet das Ergebnis mit `finish_push()` zurück.
--
-- Ereignisse (Codes wie in src/lib/push/events.ts):
--   booking_new, booking_changed, booking_review, relocate_conflict,
--   arrival_soon, pickup_soon, booking_ready, shuttle_due  (+ test für die Testbenachrichtigung)
-- App-Updates werden bewusst NICHT per Push gemeldet (nur Banner, Abschnitt 6).
--
-- Push-Inhalte enthalten keine Kundennamen und keine Kontaktdaten.
-- Der VAPID Public Key steht in settings.push_vapid_public_key (öffentlich), der private Key
-- nur als Secret der Edge Function. URL und Secret für pg_net liegen im Supabase Vault
-- (push_send_url, push_send_secret). Fehlen sie, bleibt alles in der Outbox liegen.
--
-- Rein additiv: alte App-Versionen arbeiten unverändert weiter (Abschnitt 6, Punkt 7).
-- =============================================================================

-- 1) Erweiterungen (auf Supabase vorhanden; lokal ohne sie lauffähig) -----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end;
$$;

-- 2) Einstellungen ---------------------------------------------------------------
-- roles: 'staff' = gesamtes aktives Personal (Admins eingeschlossen), 'admin' = nur Admins
insert into public.settings (key, value, description) values
  ('notifications', '{
      "events": {
        "booking_new":       {"enabled": true, "roles": ["staff"]},
        "booking_changed":   {"enabled": true, "roles": ["staff"]},
        "booking_review":    {"enabled": true, "roles": ["admin"]},
        "relocate_conflict": {"enabled": true, "roles": ["staff"]},
        "arrival_soon":      {"enabled": true, "roles": ["staff"]},
        "pickup_soon":       {"enabled": true, "roles": ["staff"]},
        "booking_ready":     {"enabled": true, "roles": ["staff"]},
        "shuttle_due":       {"enabled": true, "roles": ["staff"]}
      },
      "arrival_lead_minutes": 60,
      "pickup_lead_minutes": 60,
      "relocate_reminder_minutes": 60,
      "shuttle_lead_minutes": 15
   }',
   'Push-Benachrichtigungen: Ereignisse an/aus, Empfänger-Rollen (staff = alle, admin = nur Admins), Vorlaufzeiten in Minuten'),
  ('push_vapid_public_key', '""',
   'Öffentlicher VAPID-Schlüssel (base64url) für Web Push; der private Schlüssel liegt nur als Secret der Edge Function push-send')
on conflict (key) do nothing;

-- 3) Tabellen ----------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text,
  device_label text not null default '',
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  user_agent text check (length(user_agent) <= 500),
  events text[] not null default '{}',
  active boolean not null default true,
  last_success_at timestamptz,
  last_error text,
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.push_subscriptions is 'Web-Push-Abos je Gerät und Nutzer, mit abonnierten Ereignissen';

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where active;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  ref_type text,
  ref_id uuid,
  dedupe_key text not null unique,
  payload jsonb not null,
  target_roles text[] not null default '{staff}',
  target_user_id uuid,
  target_subscription_id uuid references public.push_subscriptions (id) on delete cascade,
  exclude_user_id uuid,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  sent_count integer not null default 0,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notifications is
  'Outbox und Protokoll aller Push-Benachrichtigungen; wächst stetig → später nach created_at archivieren';

create index if not exists notifications_status_idx on public.notifications (status, created_at);
create index if not exists notifications_created_idx on public.notifications (created_at desc);

create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;

-- Eigene Abos sehen und pflegen; Admins sehen und schalten alle
create policy own_select on public.push_subscriptions
  for select to authenticated
  using ((select public.is_staff()) and (user_id = (select auth.uid()) or (select public.is_admin())));
create policy own_update on public.push_subscriptions
  for update to authenticated
  using ((select public.is_staff()) and (user_id = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_staff()) and (user_id = (select auth.uid()) or (select public.is_admin())));
create policy own_delete on public.push_subscriptions
  for delete to authenticated
  using ((select public.is_staff()) and (user_id = (select auth.uid()) or (select public.is_admin())));
-- Anlegen nur über save_push_subscription (Endpoint kann bereits einem anderen Konto gehören)

create policy admin_select on public.notifications
  for select to authenticated using ((select public.is_admin()));

grant select, update, delete on public.push_subscriptions to authenticated;
grant select on public.notifications to authenticated;
grant all on public.push_subscriptions, public.notifications to service_role;
revoke all on public.push_subscriptions, public.notifications from anon;

-- 4) Hilfsfunktionen ----------------------------------------------------------------
create or replace function public.notify_local_time(p_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_at at time zone 'Europe/Berlin', 'DD.MM. HH24:MI')
$$;

create or replace function public.notify_parking_label(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'indoor' then 'Halle'
    when 'outdoor_cover' then 'Außen mit Plane'
    when 'outdoor' then 'Außen ohne Plane'
    else 'Parkart offen'
  end
$$;

create or replace function public.notification_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_setting('notifications'), '{}'::jsonb)
$$;

create or replace function public.notification_lead(p_key text, p_default integer)
returns interval
language sql
stable
security definer
set search_path = public
as $$
  select make_interval(mins => greatest(0, coalesce((public.notification_settings() ->> p_key)::integer, p_default)))
$$;

-- Ereignisse der Rolle laut Einstellungen (Vorbelegung neuer Geräte)
create or replace function public.default_push_events(p_role text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.key order by e.key), '{}')
  from jsonb_each(coalesce(public.notification_settings() -> 'events', '{}'::jsonb)) e
  where coalesce((e.value ->> 'enabled')::boolean, true)
    and (
      e.value -> 'roles' ? 'staff'
      or (p_role = 'admin' and e.value -> 'roles' ? 'admin')
    )
$$;

-- Legt eine Benachrichtigung an. Prüft, ob das Ereignis eingeschaltet ist, und
-- verhindert Doppelungen über den dedupe_key. Darf eine Buchung nie blockieren.
create or replace function public.enqueue_notification(
  p_event text,
  p_ref_type text,
  p_ref_id uuid,
  p_dedupe_key text,
  p_title text,
  p_body text,
  p_url text default '/',
  p_target_user_id uuid default null,
  p_exclude_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg jsonb := public.notification_settings() -> 'events' -> p_event;
  v_id uuid;
begin
  if p_event <> 'test' and (cfg is null or not coalesce((cfg ->> 'enabled')::boolean, true)) then
    return null;
  end if;
  -- Demo-Daten (supabase/demo.sql) lösen keine Benachrichtigungen aus
  if coalesce(current_setting('app.change_source', true), '') = 'demo' then
    return null;
  end if;

  insert into public.notifications (
    event, ref_type, ref_id, dedupe_key, payload, target_roles, target_user_id, exclude_user_id
  )
  values (
    p_event, p_ref_type, p_ref_id, p_dedupe_key,
    jsonb_build_object(
      'title', p_title,
      'body', p_body,
      'url', coalesce(p_url, '/'),
      'tag', p_event || ':' || coalesce(p_ref_id::text, p_dedupe_key),
      'event', p_event
    ),
    coalesce(
      (select array_agg(r) from jsonb_array_elements_text(cfg -> 'roles') r),
      '{staff}'
    ),
    p_target_user_id,
    p_exclude_user_id
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
exception when others then
  raise warning 'Benachrichtigung % nicht angelegt: %', p_dedupe_key, sqlerrm;
  return null;
end;
$$;

-- Kurzbeschreibung einer Buchung für Push-Texte: Kennzeichen · Platz/Parkart
create or replace function public.notify_booking_place(b public.bookings)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select 'Platz ' || l.code from public.locations l where l.id = b.current_location_id),
    public.notify_parking_label(b.parking_type)
  )
$$;

-- 5) Ereignis-Trigger -----------------------------------------------------------------
create or replace function public.after_booking_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_url text := '/fahrzeuge/' || new.id;
  v_changes text[] := '{}';
  v_review text[];
  v_old_review text[] := '{}';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' then
      perform public.enqueue_notification(
        'booking_new', 'booking', new.id, 'booking_new:' || new.id,
        'Neue Buchung ' || new.plate,
        public.notify_local_time(new.start_at) || ' – ' || public.notify_local_time(new.end_at)
          || ' · ' || public.notify_parking_label(new.parking_type)
          || case when new.source <> 'manual' then ' · ' || initcap(new.source) else '' end,
        v_url, null, v_actor
      );
    end if;
  else
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      perform public.enqueue_notification(
        'booking_changed', 'booking', new.id, 'booking_cancelled:' || new.id,
        'Storno ' || new.plate,
        'Buchung storniert (war ' || public.notify_local_time(old.start_at) || ' – '
          || public.notify_local_time(old.end_at) || ')',
        v_url, null, v_actor
      );
    elsif new.status <> 'cancelled' then
      if new.start_at is distinct from old.start_at then
        v_changes := v_changes || ('Ankunft jetzt ' || public.notify_local_time(new.start_at));
      end if;
      if new.end_at is distinct from old.end_at then
        v_changes := v_changes || ('Abholung jetzt ' || public.notify_local_time(new.end_at));
      end if;
      if new.parking_type is distinct from old.parking_type then
        v_changes := v_changes || ('Parkart jetzt ' || public.notify_parking_label(new.parking_type));
      end if;
      if new.return_mode is distinct from old.return_mode then
        v_changes := v_changes || 'Rückgabeart geändert'::text;
      end if;
      if cardinality(v_changes) > 0 then
        perform public.enqueue_notification(
          'booking_changed', 'booking', new.id,
          'booking_changed:' || new.id || ':' || md5(concat_ws('|', new.start_at, new.end_at, new.parking_type, new.return_mode)),
          'Umbuchung ' || new.plate,
          array_to_string(v_changes, ' · '),
          v_url, null, v_actor
        );
      end if;
    end if;

    if new.status = 'ready' and old.status <> 'ready' then
      perform public.enqueue_notification(
        'booking_ready', 'booking', new.id,
        'booking_ready:' || new.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
        'Bereit: ' || new.plate,
        public.notify_booking_place(new) || ' · Abholung ' || public.notify_local_time(new.end_at),
        v_url, null, v_actor
      );
    end if;
    v_old_review := array(select unnest(old.import_flags) intersect select unnest(array['unknown_product', 'plate_unverified']));
  end if;

  -- Import-Hinweise, die eine Prüfung brauchen
  v_review := array(select unnest(new.import_flags) intersect select unnest(array['unknown_product', 'plate_unverified']) order by 1);
  if cardinality(v_review) > 0 and not (v_review <@ v_old_review) and new.status <> 'cancelled' then
    perform public.enqueue_notification(
      'booking_review', 'booking', new.id,
      'booking_review:' || new.id || ':' || array_to_string(v_review, ','),
      'Buchung prüfen: ' || new.plate,
      array_to_string(array(
        select case f when 'unknown_product' then 'Parkart unbekannt' else 'Kennzeichen unklar' end
        from unnest(v_review) f
      ), ' · ') || coalesce(' · #' || new.external_ref, ''),
      v_url
    );
  end if;
  return null;
end;
$$;

create trigger bookings_notify
  after insert or update of status, start_at, end_at, parking_type, return_mode, import_flags
  on public.bookings
  for each row execute function public.after_booking_notify();

create or replace function public.after_booking_import_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'needs_review' and (tg_op = 'INSERT' or old.status is distinct from 'needs_review') then
    perform public.enqueue_notification(
      'booking_review', 'booking_import', new.id, 'booking_review:import:' || new.id,
      case when new.source = 'parkos' then 'Parkos-Mail prüfen' else 'Import prüfen' end
        || coalesce(': #' || new.external_ref, ''),
      case new.mail_type
        when 'change' then 'Umbuchung – bitte von Hand übernehmen'
        when 'cancel' then 'Stornierung – bitte von Hand übernehmen'
        else coalesce(nullif(new.error, ''), 'Nicht automatisch übernommen')
      end,
      '/fahrzeuge'
    );
  end if;
  return null;
end;
$$;

create trigger booking_imports_notify
  after insert or update of status on public.booking_imports
  for each row execute function public.after_booking_import_notify();

-- Neue Umsetz-Aufgabe (Regal-Konflikt). Kein Ausschluss des Auslösers: wer den Konflikt
-- verursacht (Umbuchung, Einlagern), soll ihn ebenfalls sehen.
create or replace function public.after_relocate_task_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  if new.type = 'relocate' and new.status in ('open', 'in_progress') then
    select * into b from public.bookings where id = new.booking_id;
    perform public.enqueue_notification(
      'relocate_conflict', 'task', new.id, 'relocate_conflict:' || new.id,
      'Umsetzen nötig: ' || coalesce(b.plate, 'Fahrzeug'),
      coalesce(new.title, 'Regal-Konflikt')
        || coalesce(' · bis ' || public.notify_local_time(new.due_at), ''),
      '/aufgaben'
    );
  end if;
  return null;
end;
$$;

create trigger tasks_relocate_notify
  after insert on public.tasks
  for each row execute function public.after_relocate_task_notify();

-- 6) Zeitgesteuerte Meldungen (pg_cron alle 5 Minuten) -------------------------------
create or replace function public.enqueue_due_notifications(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  rb public.bookings;
  v_count integer := 0;
  v_id uuid;
begin
  -- Ankunft bald
  for r in
    select b.* from public.bookings b
    where b.status = 'booked'
      and b.start_at > p_now
      and b.start_at <= p_now + public.notification_lead('arrival_lead_minutes', 60)
  loop
    v_id := public.enqueue_notification(
      'arrival_soon', 'booking', r.id,
      'arrival_soon:' || r.id || ':' || extract(epoch from r.start_at)::bigint,
      'Ankunft ' || to_char(r.start_at at time zone 'Europe/Berlin', 'HH24:MI') || ': ' || r.plate,
      'in ' || ceil(extract(epoch from (r.start_at - p_now)) / 60)::integer || ' min · '
        || public.notify_parking_label(r.parking_type)
        || case when r.persons > 1 then ' · ' || r.persons || ' Personen' else '' end,
      '/fahrzeuge/' || r.id
    );
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;

  -- Abholung bald
  for rb in
    select b.* from public.bookings b
    where b.status not in ('completed', 'cancelled')
      and b.end_at > p_now
      and b.end_at <= p_now + public.notification_lead('pickup_lead_minutes', 60)
  loop
    v_id := public.enqueue_notification(
      'pickup_soon', 'booking', rb.id,
      'pickup_soon:' || rb.id || ':' || extract(epoch from rb.end_at)::bigint,
      'Abholung ' || to_char(rb.end_at at time zone 'Europe/Berlin', 'HH24:MI') || ': ' || rb.plate,
      'in ' || ceil(extract(epoch from (rb.end_at - p_now)) / 60)::integer || ' min · '
        || public.notify_booking_place(rb)
        || case rb.status when 'ready' then ' · bereit' when 'booked' then ' · noch nicht angekommen' else ' · noch nicht bereit' end,
      '/fahrzeuge/' || rb.id
    );
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;

  -- Erinnerung an offene Umsetz-Aufgaben
  for r in
    select t.id, t.title, t.due_at, b.plate
    from public.tasks t join public.bookings b on b.id = t.booking_id
    where t.type = 'relocate'
      and t.status in ('open', 'in_progress')
      and t.due_at > p_now
      and t.due_at <= p_now + public.notification_lead('relocate_reminder_minutes', 60)
  loop
    v_id := public.enqueue_notification(
      'relocate_conflict', 'task', r.id,
      'relocate_due:' || r.id || ':' || extract(epoch from r.due_at)::bigint,
      'Umsetzen bis ' || to_char(r.due_at at time zone 'Europe/Berlin', 'HH24:MI') || ': ' || r.plate,
      coalesce(r.title, 'Regal-Konflikt') || ' · noch offen',
      '/aufgaben'
    );
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;

  -- Shuttle fällig (nur Fahrten mit Fahrgästen)
  for r in
    select j.id, j.direction, j.scheduled_at, j.driver_id,
           count(p.id)::integer as bookings, coalesce(sum(p.persons), 0)::integer as persons
    from public.transport_jobs j
    join public.transport_passengers p on p.transport_job_id = j.id
    join public.bookings b on b.id = p.booking_id and b.status <> 'cancelled'
    where j.status in ('planned', 'assigned')
      and j.scheduled_at > p_now
      and j.scheduled_at <= p_now + public.notification_lead('shuttle_lead_minutes', 15)
    group by j.id
  loop
    v_id := public.enqueue_notification(
      'shuttle_due', 'transport_job', r.id,
      'shuttle_due:' || r.id || ':' || extract(epoch from r.scheduled_at)::bigint,
      'Shuttle ' || to_char(r.scheduled_at at time zone 'Europe/Berlin', 'HH24:MI')
        || case r.direction when 'to_airport' then ' zum Flughafen' else ' vom Flughafen' end,
      r.bookings || case when r.bookings = 1 then ' Buchung · ' else ' Buchungen · ' end
        || r.persons || case when r.persons = 1 then ' Person' else ' Personen' end,
      '/shuttle',
      r.driver_id
    );
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$$;

-- 7) Zustellung -------------------------------------------------------------------------
-- Stößt die Edge Function an. Ohne pg_net oder Vault-Einträge passiert nichts
-- (Einträge bleiben pending und werden beim nächsten Lauf mitgenommen).
create or replace function public.dispatch_push()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.notifications where status = 'pending' and attempts < 3)
     and not exists (select 1 from public.notifications where status = 'sending' and claimed_at < now() - interval '5 minutes') then
    return false;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return false;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'push_send_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'push_send_secret'$q$ into v_secret;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
  return true;
exception when others then
  raise warning 'Push-Zustellung nicht angestoßen: %', sqlerrm;
  return false;
end;
$$;

create or replace function public.after_notifications_insert_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.dispatch_push();
  return null;
end;
$$;

create trigger notifications_dispatch
  after insert on public.notifications
  for each statement execute function public.after_notifications_insert_dispatch();

-- Empfänger einer Benachrichtigung
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
      else n.event = any (s.events)
        and ('staff' = any (n.target_roles) or p.role = any (n.target_roles))
    end
$$;

-- Holt offene Meldungen samt Empfängern (nur Edge Function / service_role)
create or replace function public.claim_push_batch(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.notifications;
  v_recipients jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  for n in
    select * from public.notifications
    where (status = 'pending' and attempts < 3)
       or (status = 'sending' and claimed_at < now() - interval '5 minutes' and attempts < 3)
    order by created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'endpoint', r.endpoint, 'p256dh', r.p256dh, 'auth', r.auth)), '[]'::jsonb)
      into v_recipients
    from public.notification_recipients(n) r;

    if jsonb_array_length(v_recipients) = 0 then
      update public.notifications
      set status = 'skipped', error = 'Keine Empfänger', sent_at = now()
      where id = n.id;
      continue;
    end if;

    update public.notifications
    set status = 'sending', attempts = attempts + 1, claimed_at = now()
    where id = n.id;

    v_out := v_out || jsonb_build_object('id', n.id, 'payload', n.payload, 'recipients', v_recipients);
  end loop;
  return v_out;
end;
$$;

-- Ergebnis zurückmelden. p_results: [{"subscription_id", "ok", "gone", "error"}]
create or replace function public.finish_push(p_id uuid, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok integer;
  v_failed integer;
  v_error text;
begin
  update public.push_subscriptions s
  set last_success_at = now(), failure_count = 0, last_error = null
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
  where s.id = (r ->> 'subscription_id')::uuid and coalesce((r ->> 'ok')::boolean, false);

  -- 404/410: Abo existiert beim Push-Dienst nicht mehr → abschalten; sonst nach 5 Fehlern
  update public.push_subscriptions s
  set failure_count = s.failure_count + 1,
      last_error = left(r ->> 'error', 300),
      active = case
        when coalesce((r ->> 'gone')::boolean, false) then false
        when s.failure_count + 1 >= 5 then false
        else s.active
      end
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
  where s.id = (r ->> 'subscription_id')::uuid and not coalesce((r ->> 'ok')::boolean, false);

  select count(*) filter (where coalesce((r ->> 'ok')::boolean, false)),
         count(*) filter (where not coalesce((r ->> 'ok')::boolean, false) and not coalesce((r ->> 'gone')::boolean, false)),
         string_agg(distinct left(r ->> 'error', 200), '; ')
    into v_ok, v_failed, v_error
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r;

  update public.notifications
  set sent_count = sent_count + v_ok,
      error = v_error,
      status = case
        when v_ok > 0 or v_failed = 0 then 'sent'
        when attempts >= 3 then 'failed'
        else 'pending'
      end,
      sent_at = case when v_ok > 0 or v_failed = 0 or attempts >= 3 then now() else null end
  where id = p_id;
end;
$$;

-- 8) Geräte-Abos (App) ---------------------------------------------------------------------
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
  v_role text;
  v_row public.push_subscriptions;
  v_known text[] := array(select jsonb_object_keys(public.notification_settings() -> 'events'));
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = v_uid;

  -- Dasselbe Gerät (Endpoint) wechselt ggf. das Konto → übernimmt es mit neuen Ereignissen
  insert into public.push_subscriptions (
    user_id, device_id, device_label, endpoint, p256dh, auth, user_agent, events
  )
  values (
    v_uid, p_device_id, left(coalesce(btrim(p_device_label), ''), 60), p_endpoint, p_p256dh, p_auth,
    left(p_user_agent, 500),
    case
      when p_events is null then public.default_push_events(v_role)
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

  -- Ein Gerät hat nur ein aktives Abo (alter Endpoint nach Neuinstallation)
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
  if not public.is_staff() then
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
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

-- Testbenachrichtigung an genau dieses Gerät
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
  if not public.is_staff() then
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

-- 9) Rechte ----------------------------------------------------------------------------------
revoke execute on function
  public.notify_local_time(timestamptz),
  public.notify_parking_label(text),
  public.notification_settings(),
  public.notification_lead(text, integer),
  public.enqueue_notification(text, text, uuid, text, text, text, text, uuid, uuid),
  public.notify_booking_place(public.bookings),
  public.after_booking_notify(),
  public.after_booking_import_notify(),
  public.after_relocate_task_notify(),
  public.enqueue_due_notifications(timestamptz),
  public.dispatch_push(),
  public.after_notifications_insert_dispatch(),
  public.notification_recipients(public.notifications),
  public.claim_push_batch(integer),
  public.finish_push(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.claim_push_batch(integer),
  public.finish_push(uuid, jsonb),
  public.enqueue_due_notifications(timestamptz),
  public.dispatch_push()
  to service_role;

revoke execute on function
  public.default_push_events(text),
  public.save_push_subscription(text, text, text, text, text, text, text[]),
  public.set_push_events(text, text[]),
  public.remove_push_subscription(text),
  public.send_test_push(text)
  from public, anon;
grant execute on function
  public.default_push_events(text),
  public.save_push_subscription(text, text, text, text, text, text, text[]),
  public.set_push_events(text, text[]),
  public.remove_push_subscription(text),
  public.send_test_push(text)
  to authenticated;

-- 10) Zeitplan (nur wenn pg_cron vorhanden) ---------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('push-due-notifications', '*/5 * * * *', 'select public.enqueue_due_notifications()');
    perform cron.schedule('push-dispatch', '* * * * *', 'select public.dispatch_push()');
  end if;
end;
$$;
