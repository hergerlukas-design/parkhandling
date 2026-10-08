-- Pflicht zum Passwortwechsel nach Einladung (abwärtskompatibel: nur additiv)
alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- Eigenes Flag zurücksetzen: Nutzer dürfen ihr Profil sonst nicht ändern (RLS: nur Admin schreibt)
create or replace function public.complete_password_change()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set must_change_password = false, updated_at = now()
   where id = auth.uid()
$$;

revoke execute on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;
