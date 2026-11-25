-- =============================================================================
-- Kunden-QR-Code (Check-in-Ticket des Rechners) im Dashboard (0.39.0)
--  * bookings.checkin_token_hash: SHA-256 des Ticket-Codes aus dem QR-Code
--    (https://parkhandling-rechner.pplx.app/ticket.html#<32 Hex>), nur als Hash gespeichert
--  * bookings.carhandling_checked_in_at / _checked_out_at: Check-in-Stand bei CarHandling (per Webhook)
--  * find_booking_by_scan: Buchung zu gescanntem Ticket-Code oder Buchungsnummer (nur Mitarbeitende)
--  * sync_external_booking übernimmt Ticket-Code und Check-in-Stand (gleiche Signatur)
--  * Nachtrag: Ticket-Code bestehender Rechner-Buchungen aus dem Link in der Notiz
-- =============================================================================

alter table public.bookings
  add column if not exists checkin_token_hash text,
  add column if not exists carhandling_checked_in_at timestamptz,
  add column if not exists carhandling_checked_out_at timestamptz;

comment on column public.bookings.checkin_token_hash is
  'SHA-256 (hex) des Check-in-Tickets aus dem Kunden-QR-Code des Rechners (CarHandling).';
comment on column public.bookings.carhandling_checked_in_at is
  'Check-in laut CarHandling-Backend (checked_in_at); null = dort nicht angenommen.';
comment on column public.bookings.carhandling_checked_out_at is
  'Check-out laut CarHandling-Backend (checked_out_at); null = dort nicht ausgecheckt.';

create unique index if not exists bookings_checkin_token_hash_key
  on public.bookings (checkin_token_hash) where checkin_token_hash is not null;

create or replace function public.ticket_hash(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(lower(btrim(p_token)), 'UTF8')), 'hex')
$$;

-- Nachtrag aus dem Ticket-Link in der Notiz (vor 0.39.0 übernommene Rechner-Buchungen)
update public.bookings
set checkin_token_hash = public.ticket_hash(substring(notes from 'ticket\.html#([0-9a-fA-F]{32})'))
where source = 'carhandling'
  and checkin_token_hash is null
  and notes ~ 'ticket\.html#[0-9a-fA-F]{32}';

-- Gescannter Code → Buchung. Versteht den Ticket-Link, den reinen Ticket-Code und die Buchungsnummer.
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
  b public.bookings;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if v_token is not null then
    select * into b from public.bookings where checkin_token_hash = public.ticket_hash(v_token);
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

revoke all on function public.find_booking_by_scan(text) from public, anon;
grant execute on function public.find_booking_by_scan(text) to authenticated;

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
  v_token text := lower(nullif(btrim(p ->> 'checkin_token'), ''));
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

        -- Kunden-QR (Check-in-Ticket) und Check-in-Stand von CarHandling
        update public.bookings b set
          checkin_token_hash = case when v_token ~ '^[0-9a-f]{32}$'
                                    then public.ticket_hash(v_token) else b.checkin_token_hash end,
          carhandling_checked_in_at = case when p ? 'checked_in_at'
                                           then (p ->> 'checked_in_at')::timestamptz else b.carhandling_checked_in_at end,
          carhandling_checked_out_at = case when p ? 'checked_out_at'
                                            then (p ->> 'checked_out_at')::timestamptz else b.carhandling_checked_out_at end
        where b.id = v_booking_id
          and (b.checkin_token_hash is distinct from case when v_token ~ '^[0-9a-f]{32}$'
                                                          then public.ticket_hash(v_token) else b.checkin_token_hash end
               or (p ? 'checked_in_at' and b.carhandling_checked_in_at is distinct from (p ->> 'checked_in_at')::timestamptz)
               or (p ? 'checked_out_at' and b.carhandling_checked_out_at is distinct from (p ->> 'checked_out_at')::timestamptz));
        if found and v_status = 'unchanged' then v_status := 'updated'; end if;
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

