-- =============================================================================
-- Aushilfen per QR-Code freischalten (0.40.0, Entscheidung Lukas 25.11.2026)
--  * Personal (staff/admin) erzeugt in der App einen Freischalt-Code (15 Minuten gültig)
--  * Die Aushilfe scannt ihn mit dem eigenen Handy: anonyme Anmeldung (Supabase Auth),
--    redeem_helper_invite schaltet das Konto mit Rolle „helper“ bis Tagesende (Berlin) frei
--  * helper zählt für die Datenrechte als Personal (Protokolle, Fotos, Einchecken), die App zeigt
--    aber nur Scannen, Annahme, Rückgabe und Einchecken. Nach access_until gilt das Konto als gesperrt
-- Additiv und abwärtskompatibel.
-- =============================================================================

alter table public.profiles
  add column if not exists access_until timestamptz;

comment on column public.profiles.access_until is
  'Zugang endet zu diesem Zeitpunkt (Aushilfen: Tagesende); null = unbegrenzt.';

alter table public.profiles drop constraint if exists profiles_roles_check;
alter table public.profiles
  add constraint profiles_roles_check
  check (cardinality(roles) >= 1 and roles <@ array['admin', 'staff', 'driver', 'helper']);

-- Rechte: abgelaufene Zugänge zählen nicht ------------------------------------------
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and active and (access_until is null or access_until > now()))
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and roles && array['admin', 'staff', 'helper']
      and (access_until is null or access_until > now())
  )
$$;

-- Festes Personal (ohne Aushilfen): darf Aushilfen freischalten und sperren
create or replace function public.is_personnel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and roles && array['admin', 'staff']
      and (access_until is null or access_until > now())
  )
$$;

revoke execute on function public.is_personnel() from public, anon;
grant execute on function public.is_personnel() to authenticated;

-- Freischalt-Codes -------------------------------------------------------------------
create table if not exists public.helper_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  display_name text not null check (length(btrim(display_name)) between 2 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  access_until timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null
);

comment on table public.helper_invites is
  'Einmal-Codes zur Freischaltung von Aushilfen (nur Hash gespeichert). Zugriff nur über Funktionen.';

alter table public.helper_invites enable row level security;
revoke all on public.helper_invites from anon, authenticated;

/** Ende des heutigen Tages in Berlin */
create or replace function public.berlin_end_of_day(p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((p_at at time zone 'Europe/Berlin')::date + 1)::timestamp at time zone 'Europe/Berlin'
$$;

create or replace function public.create_helper_invite(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + interval '15 minutes';
  v_until timestamptz := public.berlin_end_of_day();
begin
  if not public.is_personnel() then
    raise exception 'Nur Personal darf Aushilfen freischalten' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Bitte einen Namen (2 bis 60 Zeichen) eingeben' using errcode = '22023';
  end if;
  insert into public.helper_invites (code_hash, display_name, created_by, expires_at, access_until)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_name, auth.uid(), v_expires, v_until);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires, 'access_until', v_until);
end;
$$;

-- Nur für anonym angemeldete Geräte: echte Konten werden nie zu Aushilfen umgebaut
create or replace function public.redeem_helper_invite(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  inv public.helper_invites;
begin
  if v_uid is null or not v_anon then
    raise exception 'Freischaltung nur auf einem Gerät ohne eigenes Konto' using errcode = '42501';
  end if;
  select * into inv from public.helper_invites
  where code_hash = encode(sha256(convert_to(lower(btrim(coalesce(p_code, ''))), 'UTF8')), 'hex')
  for update;
  if inv.id is null or inv.redeemed_at is not null or inv.expires_at <= now() then
    raise exception 'Freischalt-Code ungültig, schon benutzt oder abgelaufen' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, display_name, email)
  values (v_uid, inv.display_name, null)
  on conflict (id) do nothing;
  update public.profiles
  set display_name = inv.display_name, roles = array['helper'], active = true,
      access_until = inv.access_until, must_change_password = false, updated_at = now()
  where id = v_uid;

  update public.helper_invites set redeemed_at = now(), redeemed_by = v_uid where id = inv.id;
  return jsonb_build_object('display_name', inv.display_name, 'access_until', inv.access_until);
end;
$$;

-- Aktive Aushilfen (für die Liste in den Einstellungen)
create or replace function public.list_helpers()
returns table (id uuid, display_name text, access_until timestamptz, invited_by text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.access_until, c.display_name
  from public.profiles p
  left join public.helper_invites i on i.redeemed_by = p.id
  left join public.profiles c on c.id = i.created_by
  where public.is_personnel()
    and 'helper' = any (p.roles) and p.active and p.access_until > now()
  order by p.access_until desc, p.display_name
$$;

create or replace function public.revoke_helper(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_personnel() then
    raise exception 'Nur Personal darf Aushilfen sperren' using errcode = '42501';
  end if;
  update public.profiles
  set active = false, access_until = least(coalesce(access_until, now()), now()), updated_at = now()
  where id = p_id and roles = array['helper'];
end;
$$;

revoke all on function public.create_helper_invite(text), public.redeem_helper_invite(text),
  public.list_helpers(), public.revoke_helper(uuid) from public, anon;
grant execute on function public.create_helper_invite(text), public.redeem_helper_invite(text),
  public.list_helpers(), public.revoke_helper(uuid) to authenticated;
