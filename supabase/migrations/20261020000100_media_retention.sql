-- =============================================================================
-- Version 0.22.0: Aufbewahrung von Fotos (Arbeitsanweisung 11.4)
--   * Vollbild-Fotos werden nach Ablauf der Frist (settings.media_retention_days, Standard 365 Tage
--     nach Buchungsende) gelöscht. Thumbnails, Unterschriften und PDF-Protokolle bleiben.
--     Kundendaten der Buchung werden nicht angefasst (Entscheidung Lukas 20.10.2026).
--   * Nur abgeschlossene oder stornierte Buchungen; Fotos ohne Thumbnail bleiben, damit von jedem
--     Foto immer etwas sichtbar ist.
--   * Gelöscht wird in der Edge Function media-retention (Storage-API), die Datenbank markiert die
--     Zeile mit archived_at. Jeder Lauf steht in media_retention_runs.
--   * Täglicher Lauf per pg_cron → pg_net → Edge Function. Der Job tut nichts, solange
--     settings.media_retention_job_enabled = false ist (Standard); ein Admin schaltet ihn in den
--     Einstellungen ein.
-- =============================================================================

update public.settings
   set description = 'Vollbild-Fotos so viele Tage nach Buchungsende löschen (Thumbnails und PDFs bleiben)'
 where key = 'media_retention_days';
update public.settings
   set description = 'Täglicher Lösch-Job für Vollbild-Fotos aktiv (Admin schaltet in den Einstellungen ein)'
 where key = 'media_retention_job_enabled';

-- -----------------------------------------------------------------------------
-- Protokoll der Läufe
-- -----------------------------------------------------------------------------
create table if not exists public.media_retention_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'manual')),
  triggered_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  retention_days integer not null,
  deleted_count integer not null default 0,
  freed_bytes bigint not null default 0,
  failed_count integer not null default 0,
  error text
);

create index if not exists media_retention_runs_started_idx on public.media_retention_runs (started_at desc);

alter table public.media_retention_runs enable row level security;

drop policy if exists media_retention_runs_admin_select on public.media_retention_runs;
create policy media_retention_runs_admin_select on public.media_retention_runs
  for select to authenticated using ((select public.is_admin()));
-- Schreiben nur die Edge Function (service_role, umgeht RLS)

grant select on public.media_retention_runs to authenticated;

-- -----------------------------------------------------------------------------
-- Welche Fotos sind fällig?
-- -----------------------------------------------------------------------------
create or replace function public.media_retention_candidates()
returns table (id uuid, bucket text, path text, bytes bigint, ended_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.bucket, m.path, m.bytes, coalesce(b.end_at, m.created_at)
    from public.media m
    left join public.bookings b on b.id = m.booking_id
   where m.kind = 'photo'
     and m.provider = 'supabase'
     and m.uploaded_at is not null
     and m.archived_at is null
     and m.thumb_path is not null
     and (b.id is null or b.status in ('completed', 'cancelled'))
     and coalesce(b.end_at, m.created_at)
         < now() - make_interval(days => coalesce((public.get_setting('media_retention_days') #>> '{}')::integer, 365))
$$;

-- Nächster Stapel für die Edge Function (älteste zuerst)
create or replace function public.media_retention_due(p_limit integer default 200)
returns table (id uuid, bucket text, path text, bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.bucket, c.path, c.bytes
    from public.media_retention_candidates() c
   order by c.ended_at, c.id
   limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- Vorschau für die Einstellungen: Anzahl und Größe der fälligen Fotos (nur Admins)
create or replace function public.media_retention_preview()
returns table (due_count bigint, due_bytes bigint, oldest_end_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur Admins' using errcode = '42501';
  end if;
  return query
    select count(*), coalesce(sum(c.bytes), 0)::bigint, min(c.ended_at)
      from public.media_retention_candidates() c;
end;
$$;

revoke execute on function public.media_retention_candidates() from public, anon, authenticated;
revoke execute on function public.media_retention_due(integer) from public, anon, authenticated;
grant execute on function public.media_retention_due(integer) to service_role;
revoke execute on function public.media_retention_preview() from public, anon;
grant execute on function public.media_retention_preview() to authenticated;

-- Speicherverbrauch: von gelöschten Vollbildern zählt nur noch das Thumbnail
create or replace function public.media_usage()
returns table (file_count bigint, total_bytes bigint, pending_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where uploaded_at is not null and archived_at is null)
      + count(*) filter (where uploaded_at is not null and thumb_path is not null),
    coalesce(sum(case when archived_at is null then bytes + thumb_bytes else thumb_bytes end)
      filter (where uploaded_at is not null), 0)::bigint,
    count(*) filter (where uploaded_at is null)
  from public.media
  where (select public.is_staff())
$$;

-- -----------------------------------------------------------------------------
-- Täglicher Aufruf (pg_cron + pg_net), nur auf Supabase
-- -----------------------------------------------------------------------------
-- Prüft das Geheimnis, mit dem pg_cron die Edge Function aufruft (nur service_role)
create or replace function public.media_retention_check_secret(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null or coalesce(p_secret, '') = '' then
    return false;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into v_secret using 'media_retention_cron_secret';
  return v_secret is not null and v_secret = p_secret;
end;
$$;

revoke execute on function public.media_retention_check_secret(text) from public, anon, authenticated;
grant execute on function public.media_retention_check_secret(text) to service_role;

-- Ruft die Edge Function auf; ohne Projekt-URL im Vault oder bei ausgeschaltetem Job passiert nichts
create or replace function public.media_retention_tick()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  if coalesce((public.get_setting('media_retention_job_enabled') #>> '{}')::boolean, false) is not true then
    return 'aus';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    return 'kein Vault';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'media_retention_cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'media_retention_tick: Vault-Secret project_url oder media_retention_cron_secret fehlt';
    return 'nicht eingerichtet';
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 120000)'
    using rtrim(v_url, '/') || '/functions/v1/media-retention',
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          '{"mode": "cron"}'::jsonb;
  return 'gestartet';
end;
$$;

revoke execute on function public.media_retention_tick() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or to_regnamespace('vault') is null then
    raise notice 'pg_cron/pg_net/Vault nicht verfügbar – täglicher Lösch-Job wird nicht eingeplant';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  -- Geheimnis für den Aufruf aus pg_cron einmalig erzeugen
  if not exists (select 1 from vault.secrets where name = 'media_retention_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'media_retention_cron_secret',
      'Aufruf der Edge Function media-retention aus pg_cron');
  end if;

  -- 03:15 UTC = nachts, außerhalb des Betriebs
  perform cron.unschedule(jobid) from cron.job where jobname = 'media-retention';
  perform cron.schedule('media-retention', '15 3 * * *', 'select public.media_retention_tick()');
end;
$$;
