-- =============================================================================
-- Stellplatz-Layout: Halle 8 Regale × 2 Ebenen (E3 entfällt), außen max. 80 Plätze
-- (A1/A2 und B1/B2 je 20 statt 24). Wegfallende Plätze werden deaktiviert statt
-- gelöscht, damit die Bewegungshistorie erhalten bleibt. Belegte Plätze bleiben
-- aktiv, bis das Fahrzeug umgesetzt ist (Hinweis im Log); danach erneut ausführen.
-- =============================================================================

do $$
declare
  v_occupied text;
begin
  select string_agg(l.code, ', ' order by l.code) into v_occupied
  from public.locations l
  where l.active
    and ((l.area = 'hall' and l.level > 2) or (l.area in ('outdoor_a', 'outdoor_b') and l.number > 20))
    and exists (select 1 from public.bookings b where b.current_location_id = l.id);
  if v_occupied is not null then
    raise notice 'Noch belegt, bleiben vorerst aktiv: %', v_occupied;
  end if;

  update public.locations l
  set active = false, status = 'free', updated_at = now()
  where l.active
    and ((l.area = 'hall' and l.level > 2) or (l.area in ('outdoor_a', 'outdoor_b') and l.number > 20))
    and not exists (select 1 from public.bookings b where b.current_location_id = l.id);
end;
$$;
