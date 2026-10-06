-- Aus der Migrationshistorie in Supabase übernommen.
-- Altes Schema (erster Anlauf) nicht löschen, sondern nach legacy_v1 verschieben (umkehrbar).
create schema if not exists legacy_v1;
revoke all on schema legacy_v1 from public, anon, authenticated;
alter table public.booking_history set schema legacy_v1;
alter table public.transport_passengers set schema legacy_v1;
alter table public.transport_jobs set schema legacy_v1;
alter table public.protocols set schema legacy_v1;
alter table public.keys set schema legacy_v1;
alter table public.vehicle_movements set schema legacy_v1;
alter table public.media set schema legacy_v1;
alter table public.tasks set schema legacy_v1;
alter table public.booking_services set schema legacy_v1;
alter table public.bookings set schema legacy_v1;
alter table public.locations set schema legacy_v1;
alter table public.services set schema legacy_v1;
alter table public.settings set schema legacy_v1;
alter table public.profiles set schema legacy_v1;
do $$
declare f regprocedure;
begin
  -- is_staff/is_admin bleiben: bestehende Storage-Policies verweisen darauf und die neue Migration
  -- ersetzt nur ihren Inhalt (gleiche Funktion, neue profiles-Tabelle)
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and p.proname not in ('is_staff', 'is_admin') loop
    execute format('alter function %s set schema legacy_v1', f);
  end loop;
end $$;
