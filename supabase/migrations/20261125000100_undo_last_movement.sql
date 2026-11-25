-- =============================================================================
-- 0.39.0 Letzte Fahrzeugbewegung rückgängig machen
--
-- Versehentliches Einlagern oder Umsetzen lässt sich in der App zurücknehmen:
--   * nur die jüngste Bewegung einer Buchung, keine Übergabe (Auschecken)
--   * Fahrzeug steht danach wieder dort, wo es vorher stand (bzw. auf keinem Platz)
--   * Buchungsstatus: zurück auf den Stand vor der Bewegung, sofern er seitdem
--     nicht anders geändert wurde (z. B. Eingelagert → Gebucht)
--   * die Bewegung wird gelöscht (vehicle_movements bleibt für die App append-only),
--     die Rücknahme steht dafür in der Buchungshistorie (movement_undone)
--
-- Rein additiv: alte App-Versionen arbeiten unverändert weiter.
-- =============================================================================

create or replace function public.undo_last_movement(p_booking_id uuid, p_movement_id uuid)
returns jsonb
language plpgsql
-- definer: löscht aus vehicle_movements (für authenticated gesperrt); Zugriff wird unten geprüft
security definer
set search_path = public
as $$
declare
  b public.bookings;
  m public.vehicle_movements;
  src public.locations;
  dst public.locations;
  v_hist jsonb;
  v_status text;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'Buchung nicht gefunden' using errcode = 'P0002';
  end if;
  if b.status in ('completed', 'cancelled') then
    raise exception 'Buchung ist % – Rückgängig nicht möglich', b.status using errcode = 'P0001';
  end if;

  -- nur die jüngste Bewegung (gleiche Reihenfolge wie after_vehicle_movement_insert)
  select * into m from public.vehicle_movements
  where booking_id = b.id
  order by moved_at desc, created_at desc
  limit 1;
  if m.id is null or m.id <> p_movement_id then
    raise exception 'Nur die letzte Bewegung kann rückgängig gemacht werden' using errcode = 'P0001';
  end if;
  if m.to_location_id is null then
    raise exception 'Eine Übergabe kann nicht rückgängig gemacht werden' using errcode = 'P0001';
  end if;

  select * into src from public.locations where id = m.from_location_id;
  select * into dst from public.locations where id = m.to_location_id;
  if src.id is not null and public.location_occupancy(src.id) >= src.capacity then
    raise exception 'Platz % ist inzwischen belegt – bitte umsetzen statt rückgängig machen', src.code
      using errcode = 'P0001';
  end if;

  -- Status vor der Bewegung: Historieneintrag aus derselben Transaktion wie die Bewegung
  select h.changed_fields -> 'status' into v_hist
  from public.booking_history h
  where h.booking_id = b.id and h.changed_at = m.created_at and h.changed_fields ? 'status'
  order by h.created_at desc
  limit 1;
  v_status := case
    when v_hist ->> 'new' = b.status then v_hist ->> 'old'
    else b.status
  end;

  delete from public.vehicle_movements where id = m.id;

  update public.bookings
  set current_location_id = m.from_location_id,
      status = v_status
  where id = b.id;

  perform public.log_booking_change(b.id, jsonb_build_object('movement_undone', jsonb_build_object(
    'from', src.code, 'to', dst.code, 'moved_at', m.moved_at, 'reason', m.reason)));
  perform public.refresh_booking_readiness(b.id);

  return jsonb_build_object(
    'from', dst.code,
    'to', src.code,
    'status', (select status from public.bookings where id = b.id)
  );
end;
$$;

revoke execute on function public.undo_last_movement(uuid, uuid) from public, anon;
grant execute on function public.undo_last_movement(uuid, uuid) to authenticated;
