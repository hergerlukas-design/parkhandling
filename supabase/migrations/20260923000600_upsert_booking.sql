-- =============================================================================
-- Buchungsschnittstelle: idempotentes Anlegen/Aktualisieren (Abschnitt 4)
-- Einziger Schreibweg für Adapter (manuell, CSV/Excel, später Webhook/API).
--  * Idempotenz über (source, external_ref)
--  * Umbuchung: gleiche external_ref → Update + booking_history (Quelle = source)
--  * Leistungen: neue Codes → buchen (Aufgaben per Trigger), fehlende → stornieren
--    (Standardleistungen bleiben immer gebucht)
-- Läuft mit den Rechten des Aufrufers (RLS greift).
-- =============================================================================

create or replace function public.upsert_booking(p_booking jsonb, p_source text default 'manual')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  p jsonb := p_booking;
  v_ref text := nullif(btrim(p ->> 'external_ref'), '');
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual');
  v_cancel boolean := coalesce((p ->> 'cancelled')::boolean, false);
  existing public.bookings;
  v_id uuid;
  v_action text;
  v_codes text[];
  v_unknown text[] := '{}';
  v_history_before integer := 0;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;

  -- Quelle für booking_history (nur für diese Transaktion)
  perform set_config('app.change_source', v_source, true);

  if v_ref is not null then
    select * into existing from public.bookings
    where source = v_source and external_ref = v_ref
    for update;
  end if;

  if existing.id is null then
    insert into public.bookings (
      source, external_ref, customer_name, customer_email, customer_phone, plate, vehicle_model,
      persons, start_at, end_at, parking_type, return_mode, notes, status
    ) values (
      v_source,
      v_ref,
      p ->> 'customer_name',
      nullif(p ->> 'customer_email', ''),
      nullif(p ->> 'customer_phone', ''),
      p ->> 'plate',
      nullif(p ->> 'vehicle_model', ''),
      coalesce((p ->> 'persons')::smallint, 1),
      (p ->> 'start_at')::timestamptz,
      (p ->> 'end_at')::timestamptz,
      p ->> 'parking_type',
      coalesce(nullif(p ->> 'return_mode', ''), 'shuttle'),
      nullif(p ->> 'notes', ''),
      case when v_cancel then 'cancelled' else 'booked' end
    )
    returning id into v_id;
    v_action := 'created';
  else
    v_id := existing.id;
    select count(*) into v_history_before from public.booking_history where booking_id = v_id;

    update public.bookings b set
      customer_name  = case when p ? 'customer_name'  then p ->> 'customer_name' else b.customer_name end,
      customer_email = case when p ? 'customer_email' then nullif(p ->> 'customer_email', '') else b.customer_email end,
      customer_phone = case when p ? 'customer_phone' then nullif(p ->> 'customer_phone', '') else b.customer_phone end,
      plate          = case when p ? 'plate'          then p ->> 'plate' else b.plate end,
      vehicle_model  = case when p ? 'vehicle_model'  then nullif(p ->> 'vehicle_model', '') else b.vehicle_model end,
      persons        = case when p ? 'persons'        then coalesce((p ->> 'persons')::smallint, b.persons) else b.persons end,
      start_at       = case when p ? 'start_at'       then (p ->> 'start_at')::timestamptz else b.start_at end,
      end_at         = case when p ? 'end_at'         then (p ->> 'end_at')::timestamptz else b.end_at end,
      parking_type   = case when p ? 'parking_type'   then p ->> 'parking_type' else b.parking_type end,
      return_mode    = case when p ? 'return_mode'    then coalesce(nullif(p ->> 'return_mode', ''), b.return_mode) else b.return_mode end,
      notes          = case when p ? 'notes'          then nullif(p ->> 'notes', '') else b.notes end,
      status         = case when v_cancel and b.status not in ('cancelled', 'completed') then 'cancelled' else b.status end
    where b.id = v_id
      and (
        (p ? 'customer_name'  and b.customer_name  is distinct from p ->> 'customer_name')
        or (p ? 'customer_email' and b.customer_email is distinct from nullif(p ->> 'customer_email', ''))
        or (p ? 'customer_phone' and b.customer_phone is distinct from nullif(p ->> 'customer_phone', ''))
        or (p ? 'plate'          and b.plate          is distinct from p ->> 'plate')
        or (p ? 'vehicle_model'  and b.vehicle_model  is distinct from nullif(p ->> 'vehicle_model', ''))
        or (p ? 'persons'        and b.persons        is distinct from coalesce((p ->> 'persons')::smallint, b.persons))
        or (p ? 'start_at'       and b.start_at       is distinct from (p ->> 'start_at')::timestamptz)
        or (p ? 'end_at'         and b.end_at         is distinct from (p ->> 'end_at')::timestamptz)
        or (p ? 'parking_type'   and b.parking_type   is distinct from p ->> 'parking_type')
        or (p ? 'return_mode'    and b.return_mode    is distinct from coalesce(nullif(p ->> 'return_mode', ''), b.return_mode))
        or (p ? 'notes'          and b.notes          is distinct from nullif(p ->> 'notes', ''))
        or (v_cancel and b.status not in ('cancelled', 'completed'))
      );
    -- Schritt 6: bei geändertem end_at eines Hallenfahrzeugs hier die Regalprüfung auslösen.
  end if;

  -- Leistungen abgleichen (nur wenn der Adapter Leistungen liefert)
  if p ? 'services' and jsonb_typeof(p -> 'services') = 'array' then
    v_codes := array(
      select distinct upper(btrim(c)) from jsonb_array_elements_text(p -> 'services') c where btrim(c) <> ''
    );
    v_unknown := array(
      select c from unnest(v_codes) c
      where not exists (select 1 from public.services s where s.code = c and s.active)
    );

    insert into public.booking_services (booking_id, service_id, price_at_booking)
    select v_id, s.id, s.price
    from public.services s
    where s.code = any (v_codes) and s.active
    on conflict (booking_id, service_id) do update
      set status = 'active'
      where public.booking_services.status = 'cancelled';

    update public.booking_services bs
    set status = 'cancelled'
    from public.services s
    where bs.service_id = s.id
      and bs.booking_id = v_id
      and bs.status = 'active'
      and not s.is_default
      and not (s.code = any (v_codes));
  end if;

  if v_action is null then
    v_action := case
      when (select count(*) from public.booking_history where booking_id = v_id) > v_history_before then 'updated'
      else 'unchanged'
    end;
  end if;

  return jsonb_build_object('id', v_id, 'action', v_action, 'unknown_services', to_jsonb(v_unknown));
end;
$$;

revoke execute on function public.upsert_booking(jsonb, text) from public, anon;
grant execute on function public.upsert_booking(jsonb, text) to authenticated;
