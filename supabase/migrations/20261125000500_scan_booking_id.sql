-- =============================================================================
-- QR-Code im Fahrzeug-Detail (0.42.0): Buchungen ohne Kunden-QR und ohne PH-Nummer (z. B. Parkos)
-- bekommen einen QR-Code „PF-BOOKING:<Buchungs-ID>“. find_booking_by_scan versteht ihn zusätzlich
-- zu Ticket-Link, Ticket-Code und Buchungsnummer. Gleiche Signatur; ersetzt nur die Funktion.
-- =============================================================================

create or replace function public.find_booking_by_scan(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text text := btrim(coalesce(p_code, ''));
  v_token text := lower(substring(v_text from '(?:^|#)([0-9a-fA-F]{32})$'));
  v_id text := lower(substring(v_text from '(?i)^(?:PF-BOOKING:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'));
  b public.bookings;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if v_token is not null then
    select * into b from public.bookings where checkin_token_hash = public.ticket_hash(v_token);
  elsif v_id is not null then
    select * into b from public.bookings where id = v_id::uuid;
  elsif v_text <> '' then
    select * into b from public.bookings
    where upper(external_ref) = upper(v_text)
    order by status = 'cancelled', start_at desc
    limit 1;
  end if;
  if b.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'plate', b.plate, 'external_ref', b.external_ref,
    'has_location', b.current_location_id is not null,
    'intake_final', exists (select 1 from public.protocols pr
                            where pr.booking_id = b.id and pr.type = 'intake' and pr.status = 'final'),
    'handover_final', exists (select 1 from public.protocols pr
                              where pr.booking_id = b.id and pr.type = 'handover' and pr.status = 'final'));
end;
$$;
