-- =============================================================================
-- Scanner-Zugang mit PIN und Namen, QR-Freischaltung für das ganze Dashboard (0.41.0)
-- Entscheidung Lukas 25.11.2026:
--  * /scanner: gemeinsame 4-stellige PIN (nur Admins setzen sie) + Name → Rolle „helper“ bis Tagesende
--    (nur Scannen, Annahme, Einparken, Rückgabe). Ein PIN-Wechsel beendet laufende Zugänge nicht
--  * QR-Freischaltung (create_helper_invite) gibt jetzt Zugang zum ganzen Dashboard (Rolle „staff“)
--    bis Tagesende. Tageszugänge dürfen selbst niemanden freischalten oder sperren
--  * Schutz gegen Durchprobieren: je Gerät 5 Fehlversuche in 15 Minuten, insgesamt 20 je Stunde
-- =============================================================================

-- Festes Personal = ohne Ablaufdatum (Tageszugänge per QR zählen nicht)
create or replace function public.is_personnel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and roles && array['admin', 'staff'] and access_until is null
  )
$$;

-- PIN (eine Zeile) -----------------------------------------------------------------------
create table if not exists public.scanner_pin (
  id boolean primary key default true check (id),
  pin_salt text not null,
  pin_hash text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.scanner_pin enable row level security;
revoke all on public.scanner_pin from anon, authenticated;

create table if not exists public.scanner_login_attempts (
  id bigint generated always as identity primary key,
  user_id uuid,
  attempted_at timestamptz not null default now(),
  success boolean not null
);
create index if not exists scanner_login_attempts_at_idx on public.scanner_login_attempts (attempted_at);
alter table public.scanner_login_attempts enable row level security;
revoke all on public.scanner_login_attempts from anon, authenticated;

comment on table public.scanner_pin is 'PIN des Scanner-Zugangs (/scanner), nur gesalzener Hash.';
comment on table public.scanner_login_attempts is 'Anmeldeversuche am Scanner (Sperre gegen Durchprobieren).';

create or replace function public.set_scanner_pin(p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_salt text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen die Scanner-PIN ändern' using errcode = '42501';
  end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' then
    raise exception 'Die PIN muss aus 4 Ziffern bestehen' using errcode = '22023';
  end if;
  insert into public.scanner_pin (id, pin_salt, pin_hash, updated_at, updated_by)
  values (true, v_salt, encode(sha256(convert_to(v_salt || p_pin, 'UTF8')), 'hex'), now(), auth.uid())
  on conflict (id) do update
    set pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return public.scanner_pin_status();
end;
$$;

create or replace function public.scanner_pin_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.scanner_pin;
begin
  if not public.is_admin() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select * into s from public.scanner_pin where id;
  return jsonb_build_object(
    'is_set', s.id is not null,
    'updated_at', s.updated_at,
    'updated_by', (select display_name from public.profiles where id = s.updated_by),
    'failed_last_hour', (select count(*) from public.scanner_login_attempts
                         where not success and attempted_at > now() - interval '1 hour'));
end;
$$;

-- Anmeldung am Scanner: nur auf anonym angemeldeten Geräten
create or replace function public.redeem_scanner_pin(p_pin text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_name text := btrim(coalesce(p_name, ''));
  v_until timestamptz := public.berlin_end_of_day();
  s public.scanner_pin;
begin
  if v_uid is null or not v_anon then
    raise exception 'Anmeldung am Scanner nur auf einem Gerät ohne eigenes Konto' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Bitte den Namen eingeben (2 bis 60 Zeichen)' using errcode = '22023';
  end if;
  if (select count(*) from public.scanner_login_attempts
      where user_id = v_uid and not success and attempted_at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.scanner_login_attempts
         where not success and attempted_at > now() - interval '1 hour') >= 20 then
    raise exception 'Zu viele falsche Versuche. Bitte später erneut versuchen.' using errcode = 'P0001';
  end if;

  select * into s from public.scanner_pin where id;
  if s.id is null then
    raise exception 'Der Scanner ist noch nicht eingerichtet (keine PIN)' using errcode = 'P0001';
  end if;
  if coalesce(p_pin, '') !~ '^\d{4}$'
     or encode(sha256(convert_to(s.pin_salt || p_pin, 'UTF8')), 'hex') <> s.pin_hash then
    insert into public.scanner_login_attempts (user_id, success) values (v_uid, false);
    -- Fehlversuch muss gespeichert bleiben: kein raise (würde zurückrollen)
    return jsonb_build_object('ok', false, 'error', 'PIN falsch');
  end if;

  insert into public.scanner_login_attempts (user_id, success) values (v_uid, true);
  delete from public.scanner_login_attempts where attempted_at < now() - interval '7 days';

  insert into public.profiles (id, display_name, email) values (v_uid, v_name, null)
  on conflict (id) do nothing;
  update public.profiles
  set display_name = v_name, roles = array['helper'], active = true,
      access_until = v_until, must_change_password = false, updated_at = now()
  where id = v_uid;
  return jsonb_build_object('ok', true, 'display_name', v_name, 'access_until', v_until);
end;
$$;

-- QR-Freischaltung: Zugang zum ganzen Dashboard (Rolle staff) bis Tagesende -----------------
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
  set display_name = inv.display_name, roles = array['staff'], active = true,
      access_until = inv.access_until, must_change_password = false, updated_at = now()
  where id = v_uid;

  update public.helper_invites set redeemed_at = now(), redeemed_by = v_uid where id = inv.id;
  return jsonb_build_object('display_name', inv.display_name, 'access_until', inv.access_until);
end;
$$;

-- Tageszugänge (QR = Dashboard, PIN = Scanner) für die Liste in den Einstellungen
drop function if exists public.list_helpers();
create function public.list_helpers()
returns table (id uuid, display_name text, access_until timestamptz, invited_by text, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.access_until,
         (select c.display_name from public.helper_invites i join public.profiles c on c.id = i.created_by
          where i.redeemed_by = p.id order by i.redeemed_at desc limit 1),
         case when 'helper' = any (p.roles) then 'scanner' else 'dashboard' end
  from public.profiles p
  where public.is_personnel()
    and p.email is null and p.active and p.access_until > now()
    and p.roles <@ array['staff', 'helper']
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
    raise exception 'Nur Personal darf Tageszugänge beenden' using errcode = '42501';
  end if;
  update public.profiles
  set active = false, access_until = least(coalesce(access_until, now()), now()), updated_at = now()
  where id = p_id and email is null and access_until is not null and roles <@ array['staff', 'helper'];
end;
$$;

revoke all on function public.set_scanner_pin(text), public.scanner_pin_status(),
  public.redeem_scanner_pin(text, text), public.redeem_helper_invite(text),
  public.list_helpers(), public.revoke_helper(uuid) from public, anon;
grant execute on function public.set_scanner_pin(text), public.scanner_pin_status(),
  public.redeem_scanner_pin(text, text), public.redeem_helper_invite(text),
  public.list_helpers(), public.revoke_helper(uuid) to authenticated;
