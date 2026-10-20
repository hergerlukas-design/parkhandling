-- =============================================================================
-- Version 0.22.0: Fehler aus der App erfassen (eigene Lösung statt externem Dienst)
--   * Die App meldet unbehandelte Fehler über log_client_error(). Gleiche Fehler (Fingerabdruck) eines
--     Nutzers innerhalb von 10 Minuten werden zusammengezählt statt neu angelegt; je Nutzer höchstens
--     60 neue Einträge pro Stunde.
--   * Admins sehen die Einträge in den Einstellungen; der tägliche Fehlerbericht (GitHub Actions)
--     fasst die letzten 24 Stunden in einem Issue zusammen.
--   * Einträge werden nach 90 Tagen gelöscht (pg_cron, lokal ohne pg_cron: purge_client_errors()).
-- =============================================================================

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences integer not null default 1,
  -- Verweis auf profiles (nicht auth.users), damit die Admin-Ansicht den Namen mitladen kann
  user_id uuid references public.profiles (id) on delete set null,
  device_id text,
  app_version text,
  kind text not null check (kind in ('error', 'unhandledrejection', 'react', 'manual')),
  fingerprint text not null,
  message text not null,
  stack text,
  route text,
  user_agent text
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
create index if not exists client_errors_dedupe_idx on public.client_errors (user_id, fingerprint, last_seen_at desc);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_admin_select on public.client_errors;
create policy client_errors_admin_select on public.client_errors
  for select to authenticated using ((select public.is_admin()));
drop policy if exists client_errors_admin_delete on public.client_errors;
create policy client_errors_admin_delete on public.client_errors
  for delete to authenticated using ((select public.is_admin()));

grant select, delete on public.client_errors to authenticated;

create or replace function public.log_client_error(
  p_kind text,
  p_message text,
  p_stack text default null,
  p_route text default null,
  p_app_version text default null,
  p_device_id text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_message text := left(coalesce(nullif(trim(p_message), ''), 'Unbekannter Fehler'), 1000);
  v_fingerprint text;
  v_id uuid;
begin
  if v_user is null then
    return;
  end if;
  if p_kind not in ('error', 'unhandledrejection', 'react', 'manual') then
    raise exception 'Ungültige Fehlerart' using errcode = '22023';
  end if;

  -- Gleicher Fehler = gleiche Meldung (ohne Zahlen/IDs) an derselben Stelle der App
  v_fingerprint := md5(p_kind || '|' || regexp_replace(v_message, '[0-9a-f-]{8,}|\d+', '#', 'g') || '|'
    || coalesce(split_part(left(p_stack, 2000), E'\n', 2), ''));

  select id into v_id
    from public.client_errors
   where user_id = v_user and fingerprint = v_fingerprint and last_seen_at > now() - interval '10 minutes'
   order by last_seen_at desc
   limit 1;

  if v_id is not null then
    update public.client_errors
       set occurrences = occurrences + 1, last_seen_at = now()
     where id = v_id;
    return;
  end if;

  -- Schutz vor Endlosschleifen auf einem Gerät
  if (select count(*) from public.client_errors where user_id = v_user and created_at > now() - interval '1 hour') >= 60 then
    return;
  end if;

  insert into public.client_errors (user_id, device_id, app_version, kind, fingerprint, message, stack, route, user_agent)
  values (v_user, left(p_device_id, 64), left(p_app_version, 32), p_kind, v_fingerprint, v_message,
          left(p_stack, 4000), left(p_route, 200), left(p_user_agent, 300));
end;
$$;

revoke execute on function public.log_client_error(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.log_client_error(text, text, text, text, text, text, text) to authenticated;

create or replace function public.purge_client_errors()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.client_errors where last_seen_at < now() - interval '90 days' returning 1
  )
  select count(*)::integer from deleted
$$;

revoke execute on function public.purge_client_errors() from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron nicht verfügbar – Fehlerprotokoll wird nicht automatisch bereinigt';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-client-errors';
  perform cron.schedule('purge-client-errors', '30 3 * * *', 'select public.purge_client_errors()');
end;
$$;
