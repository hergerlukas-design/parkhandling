-- Benutzerverwaltung: Konten nur per Admin-Einladung (Edge Function user-invite).
-- Abwärtskompatibel: nur additive Änderungen plus Entfernen einer nicht genutzten Löschrichtlinie.

-- E-Mail am Profil, damit die Personalliste ohne Zugriff auf auth.users auskommt
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists invited_at timestamptz;

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Neue Konten sind inaktiv; Freischaltung und Rolle setzt nur user-invite (Admin)
  insert into public.profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email, ''), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Keine Profile löschen: Nachvollziehbarkeit in booking_history / vehicle_movements
drop policy if exists profiles_admin_delete on public.profiles;

-- Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden
create or replace function public.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and old.active
     and (new.role <> 'admin' or not new.active) then
    if not exists (
      select 1 from public.profiles
       where role = 'admin' and active and id <> old.id
    ) then
      raise exception 'Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_last_admin on public.profiles;
create trigger profiles_guard_last_admin
  before update on public.profiles
  for each row execute function public.guard_last_admin();

revoke execute on function public.handle_new_user(), public.guard_last_admin()
  from public, anon, authenticated;
