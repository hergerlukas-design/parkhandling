-- =============================================================================
-- Booking-Sync (0.36.1): echte Spalten der CarHandling-Tabelle bookings
--  * Noch nicht bezahlte Buchungen (Checkout offen/abgebrochen) werden erst mit der Zahlung übernommen
--  * E-Auto laden (Spalte charging) bucht die Leistung LADEN mit 10,00 € Pauschale
-- Gleiche Signatur; ersetzt nur die Funktion.
-- =============================================================================

create or replace function public.sync_external_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := coalesce(nullif(btrim(p ->> 'source'), ''), 'carhandling');
  v_ref text := nullif(btrim(p ->> 'external_ref'), '');
  v_event text := coalesce(p ->> 'event', 'new');
  v_booking jsonb := case when jsonb_typeof(p -> 'booking') = 'object' then p -> 'booking' else '{}'::jsonb end;
  v_tariff text := nullif(btrim(p ->> 'tariff_code'), '');
  v_error text := nullif(btrim(p ->> 'error'), '');
  v_pending boolean := coalesce((p ->> 'pending')::boolean, false);
  v_charging boolean := coalesce((p ->> 'charging')::boolean, false);
  v_charging_target text := nullif(btrim(p ->> 'charging_target'), '');
  v_raw text := left(coalesce(p -> 'raw', '{}'::jsonb)::text, 200000);
  existing public.bookings;
  v_result jsonb;
  v_status text;
  v_booking_id uuid;
  v_import_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;

  if v_ref is not null then
    select * into existing from public.bookings where source = v_source and external_ref = v_ref;
  end if;

  if v_error is null then
    begin
      if v_event = 'cancel' and existing.id is null then
        -- Storno einer Buchung, die nie bei uns ankam: nichts zu tun
        v_status := 'unchanged';
      elsif v_pending and existing.id is null then
        -- Zahlung steht noch aus (Checkout offen oder abgebrochen): erst mit der Zahlung übernehmen
        v_status := 'unchanged';
      else
        if v_tariff is not null and not exists (select 1 from public.booking_tariffs where code = v_tariff) then
          v_tariff := null;
        end if;
        if not v_booking ? 'parking_type' and v_tariff is not null then
          v_booking := v_booking || jsonb_build_object(
            'parking_type', (select parking_type from public.booking_tariffs where code = v_tariff));
        end if;
        if existing.payment_status in ('paid', 'refunded') and v_booking ->> 'payment_status' in ('open', 'partial') then
          v_booking := v_booking - 'payment_status';
        end if;

        v_result := public.upsert_booking(v_booking || jsonb_build_object('external_ref', v_ref), v_source);
        v_booking_id := (v_result ->> 'id')::uuid;
        v_status := case v_result ->> 'action' when 'created' then 'imported' when 'updated' then 'updated' else 'unchanged' end;

        if v_tariff is not null and existing.tariff_code is distinct from v_tariff then
          update public.bookings set tariff_code = v_tariff where id = v_booking_id;
          perform public.apply_tariff_services(v_booking_id);
          if v_status = 'unchanged' then v_status := 'updated'; end if;
        end if;

        -- E-Auto laden: Leistung LADEN mit Pauschale (im Betrag enthalten) → Aufgabe „Laden“ per Trigger
        if v_charging and v_event <> 'cancel' then
          insert into public.booking_services (booking_id, service_id, price_at_booking, description)
          select v_booking_id, s.id, 10.00,
                 concat_ws(' · ', 'Ladeziel: ' || v_charging_target,
                           'Ladepauschale 10,00 € im Preis, Strom 0,69 €/kWh bei Rückgabe')
          from public.services s
          where s.code = 'LADEN' and s.active
          on conflict (booking_id, service_id) do nothing;
          if found and v_status = 'unchanged' then v_status := 'updated'; end if;
        end if;
      end if;
    exception when others then
      v_status := 'failed';
      v_error := sqlerrm;
    end;
  else
    v_status := 'failed';
  end if;

  -- Protokoll; unveränderte Wiederholungen nicht, damit die Liste übersichtlich bleibt
  if v_status <> 'unchanged' then
    insert into public.booking_imports (
      source, channel, external_ref, mail_type, subject, raw_text, parsed, status, error, booking_id
    ) values (
      v_source, 'webhook', v_ref,
      case when v_event = 'cancel' then 'cancel' when existing.id is null then 'new' else 'change' end,
      'CarHandling-Backend: ' || coalesce(v_ref, 'ohne Buchungsnummer'),
      v_raw, v_booking, v_status, v_error, coalesce(v_booking_id, existing.id)
    )
    returning id into v_import_id;
  end if;

  return jsonb_build_object('status', v_status, 'booking_id', coalesce(v_booking_id, existing.id),
                            'error', v_error, 'import_id', v_import_id);
end;
$$;

