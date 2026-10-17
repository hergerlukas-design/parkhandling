-- =============================================================================
-- Version 0.21.0: Hallengröße in der App umstellen (Einstellungen → Halle, nur Admin)
--   * set_hall_layout(Regale, Ebenen) legt fehlende Hallenplätze R{n}-E{m} an und aktiviert bzw.
--     deaktiviert die übrigen. Plätze werden nie gelöscht, damit Historie und QR-Codes erhalten bleiben;
--     ein späteres Vergrößern aktiviert sie wieder.
--   * Abgelehnt wird, wenn auf einem wegfallenden Platz ein Fahrzeug steht oder er reserviert ist.
--   * Ebenen bis 5 erlaubt (vorher fest 1–3). Die Regal-Logik arbeitet ohnehin je Spalte.
-- =============================================================================

alter table public.locations drop constraint if exists locations_level_check;
alter table public.locations
  add constraint locations_level_check check (level between 1 and 5);

create or replace function public.set_hall_layout(p_racks integer, p_levels integer)
returns jsonb
language plpgsql
-- definer: legt Orte an und ändert active; Zugriff nur für Admins (unten geprüft)
security definer
set search_path = public
as $$
declare
  v_blockers text;
  v_created integer;
  v_activated integer;
  v_deactivated integer;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins können die Halle umstellen' using errcode = '42501';
  end if;
  if p_racks is null or p_racks not between 1 and 30 then
    raise exception 'Regale: 1 bis 30 erlaubt' using errcode = '22023';
  end if;
  if p_levels is null or p_levels not between 1 and 5 then
    raise exception 'Ebenen: 1 bis 5 erlaubt' using errcode = '22023';
  end if;

  -- Gleichzeitige Umstellungen nacheinander ausführen
  perform pg_advisory_xact_lock(hashtext('set_hall_layout'));

  select string_agg(format('%s (%s)', l.code, coalesce(b.plate, 'reserviert')), ', ' order by l.sort_order)
  into v_blockers
  from public.locations l
  left join public.bookings b
    on b.current_location_id = l.id and b.status not in ('completed', 'cancelled')
  where l.area = 'hall' and l.active
    and (l.rack > p_racks or l.level > p_levels)
    and (b.id is not null or l.status = 'reserved');
  if v_blockers is not null then
    raise exception 'Erst umsetzen bzw. freigeben: %', v_blockers using errcode = 'P0001';
  end if;

  with created as (
    insert into public.locations (code, area, rack, rack_column, level, has_cover, qr_code, sort_order)
    select format('R%s-E%s', r, e), 'hall', r, 1, e, true, format('PF-LOC:R%s-E%s', r, e), r * 10 + e
    from generate_series(1, p_racks) r, generate_series(1, p_levels) e
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_created from created;

  with changed as (
    update public.locations
    set active = true
    where area = 'hall' and not active and rack <= p_racks and level <= p_levels
    returning 1
  )
  select count(*)::int into v_activated from changed;

  with changed as (
    update public.locations
    set active = false
    where area = 'hall' and active and (rack > p_racks or level > p_levels)
    returning 1
  )
  select count(*)::int into v_deactivated from changed;

  -- Status neu berechnen (neue Ebene über belegter Spalte ist z. B. „blocked“)
  for v_id in select id from public.locations where area = 'hall' and active loop
    perform public.refresh_location_status(v_id);
  end loop;

  return jsonb_build_object(
    'racks', p_racks,
    'levels', p_levels,
    'created', v_created,
    'activated', v_activated,
    'deactivated', v_deactivated
  );
end;
$$;

revoke execute on function public.set_hall_layout(integer, integer) from public, anon;
grant execute on function public.set_hall_layout(integer, integer) to authenticated;

comment on function public.set_hall_layout(integer, integer) is
  'Admin: Halle auf Regale × Ebenen umstellen. Legt fehlende Plätze an, (de)aktiviert die übrigen.';
