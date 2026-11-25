-- =============================================================================
-- Version 0.45.0: Einchecken erst nach abgeschlossenem Annahmeprotokoll
--   * move_vehicle lehnt die erste Platzierung eines Fahrzeugs (noch kein Stellplatz) ab,
--     solange es kein Annahmeprotokoll mit status = 'final' gibt. Gleiche Sperre wie in der App
--     (Einchecken-Seite), damit sie auch ältere App-Versionen und direkte Aufrufe erfasst.
--   * Umsetzen, Auslagern und Übergabe bereits stehender Fahrzeuge bleiben unverändert.
--   * Gleiche Signatur und Rechte; ersetzt nur die Funktion (Stand 0.18.0 + Prüfung).
-- =============================================================================

create or replace function public.move_vehicle(
  p_booking_id uuid,
  p_to_code text,
  p_reason text default null,
  p_key_code text default null
)
returns jsonb
language plpgsql
-- definer: nutzt interne Helfer (Belegung, Status-Neuberechnung); Zugriff wird unten geprüft
security definer
set search_path = public
as $$
declare
  b public.bookings;
  src public.locations;
  dst public.locations;
  v_blockers text;
  v_warnings text[] := '{}';
  v_status text;
  v_open integer;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'Buchung nicht gefunden' using errcode = 'P0002';
  end if;
  if b.status in ('completed', 'cancelled') then
    raise exception 'Buchung ist % – keine Bewegung möglich', b.status using errcode = 'P0001';
  end if;

  select * into src from public.locations where id = b.current_location_id;

  -- Einchecken (erste Platzierung, Fahrzeug steht noch nirgends) nur mit abgeschlossenem Annahmeprotokoll
  if src.id is null and p_to_code is not null and not exists (
    select 1 from public.protocols pr
    where pr.booking_id = b.id and pr.type = 'intake' and pr.status = 'final'
  ) then
    raise exception 'Einchecken von % erst nach abgeschlossenem Annahmeprotokoll', b.plate using errcode = 'P0001';
  end if;
  if p_to_code is not null then
    select * into dst from public.locations
    where code = upper(btrim(p_to_code)) or qr_code = btrim(p_to_code);
    if dst.id is null then
      raise exception 'Platz „%“ unbekannt', p_to_code using errcode = 'P0002';
    end if;
    if dst.id = src.id then
      raise exception 'Fahrzeug steht bereits auf %', dst.code using errcode = 'P0001';
    end if;
    if not dst.active then
      raise exception 'Platz % ist deaktiviert', dst.code using errcode = 'P0001';
    end if;
    if public.location_occupancy(dst.id) >= dst.capacity then
      raise exception 'Platz % ist belegt', dst.code using errcode = 'P0001';
    end if;
  end if;

  -- Auslagern nur von unten nach oben
  if src.area = 'hall' then
    select string_agg(x.plate || ' (E' || l.level || ')', ', ' order by l.level) into v_blockers
    from public.locations l
    join public.bookings x on x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
    where l.area = 'hall' and l.rack = src.rack and l.rack_column = src.rack_column and l.level < src.level;
    if v_blockers is not null then
      raise exception 'Auslagern von % nicht möglich: darunter steht %. Zuerst umsetzen.', src.code, v_blockers
        using errcode = 'P0001';
    end if;
  end if;

  -- Einlagern nur von oben nach unten
  if dst.area = 'hall' then
    select string_agg(x.plate || ' (E' || l.level || ')', ', ' order by l.level) into v_blockers
    from public.locations l
    join public.bookings x on x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
    where l.area = 'hall' and l.rack = dst.rack and l.rack_column = dst.rack_column and l.level < dst.level;
    if v_blockers is not null then
      raise exception 'Platz % nur mit Umsetzen erreichbar: darunter steht %.', dst.code, v_blockers
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.locations l
      join public.bookings x on x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
      where l.area = 'hall' and l.rack = dst.rack and l.rack_column = dst.rack_column
        and l.level > dst.level and x.end_at < b.end_at
    ) then
      v_warnings := v_warnings || format('Reihenfolge in Spalte R%s verletzt – Umsetz-Aufgabe wird angelegt.', dst.rack);
    end if;
    select count(*) into v_open from public.tasks
    where booking_id = b.id and status in ('open', 'in_progress') and type <> 'relocate';
    if v_open > 0 and dst.level > 1 then
      v_warnings := v_warnings || format('%s Leistung(en) offen – Arbeiten auf E%s kosten Umsetzvorgänge.', v_open, dst.level);
    end if;
  end if;

  insert into public.vehicle_movements (booking_id, from_location_id, to_location_id, reason)
  values (b.id, src.id, dst.id, nullif(btrim(coalesce(p_reason, '')), ''));

  -- Status-Flow
  v_status := case
    when dst.id is null then 'completed'
    when dst.area = 'transit' then 'in_transit'
    when dst.area in ('hall', 'outdoor_a', 'outdoor_b') and b.status in ('booked', 'arrived', 'in_transit') then 'stored'
    when dst.area in ('work', 'buffer') and b.status = 'booked' then 'arrived'
    when dst.area in ('work', 'buffer') and b.status = 'in_transit' then 'arrived'
    else b.status
  end;
  if v_status is distinct from b.status then
    update public.bookings set status = v_status where id = b.id;
    perform public.refresh_booking_readiness(b.id);
  end if;

  return jsonb_build_object(
    'from', src.code,
    'to', dst.code,
    'status', (select status from public.bookings where id = b.id),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;
