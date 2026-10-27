-- =============================================================================
-- 0.31.0 Import-Hinweise quittieren („Kennzeichen prüfen“)
--
-- Bisher ließ sich ein Hinweis aus bookings.import_flags nirgends erledigen; er blieb
-- dauerhaft an der Buchung stehen. Neu:
--   * confirm_booking_import_flag(id, flag): Personal bestätigt einen Hinweis
--   * bookings.import_flags_confirmed: bestätigte Hinweise; ein erneuter Import derselben
--     Mail setzt sie nicht wieder
--   * Kennzeichen von Hand geändert (Bearbeiten) gilt als geprüft
--
-- Rein additiv.
-- =============================================================================

alter table public.bookings
  add column if not exists import_flags_confirmed text[] not null default '{}';

comment on column public.bookings.import_flags_confirmed is
  'Vom Personal bestätigte Import-Hinweise; werden aus import_flags herausgehalten';

-- Bestätigte Hinweise aus import_flags herausfiltern; manuelle Kennzeichenänderung = geprüft
create or replace function public.booking_import_flags_filter()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE'
     and new.plate is distinct from old.plate
     and 'plate_unverified' = any (old.import_flags)
     and coalesce(current_setting('app.change_source', true), '') = 'manual' then
    new.import_flags_confirmed := array(
      select distinct f from unnest(new.import_flags_confirmed || array['plate_unverified']) f order by 1
    );
  end if;
  if cardinality(new.import_flags_confirmed) > 0 and cardinality(new.import_flags) > 0 then
    new.import_flags := array(
      select f from unnest(new.import_flags) f where f <> all (new.import_flags_confirmed)
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists bookings_import_flags_filter on public.bookings;
create trigger bookings_import_flags_filter
  before insert or update of import_flags, import_flags_confirmed, plate
  on public.bookings
  for each row execute function public.booking_import_flags_filter();

create or replace function public.confirm_booking_import_flag(p_id uuid, p_flag text)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_flags text[];
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  update public.bookings
  set import_flags_confirmed = array(
    select distinct f from unnest(import_flags_confirmed || array[p_flag]) f order by 1
  )
  where id = p_id and p_flag = any (import_flags)
  returning import_flags into v_flags;
  if not found then
    raise exception 'Hinweis % an Buchung % nicht offen', p_flag, p_id using errcode = 'P0002';
  end if;
  perform set_config('app.change_source', 'manual', true);
  perform public.log_booking_change(p_id, jsonb_build_object('import_confirmed', jsonb_build_object('code', p_flag)));
  return v_flags;
end;
$function$;

revoke execute on function public.confirm_booking_import_flag(uuid, text) from public, anon;
grant execute on function public.confirm_booking_import_flag(uuid, text) to authenticated;
