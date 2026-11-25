-- =============================================================================
-- Buchungen aus dem CarHandling-Buchungsbackend übernehmen (0.36.0)
--  * Der Rechner bucht inzwischen in einem eigenen Supabase-Projekt (Stripe, Check-in, Tickets).
--    Dessen Database Webhook ruft die Edge Function booking-sync auf; sie ruft
--    sync_external_booking auf. Ergebnis: eine Kopie im Dashboard, source = 'carhandling'.
--  * Angelegt/aktualisiert wird über upsert_booking (gleiche Regeln, Historie und Aufgaben wie
--    Parkos). Eindeutig über (source, external_ref) → kein Doppel bei wiederholten Aufrufen.
--  * Jeder Vorgang steht in booking_imports (channel 'webhook'); fehlerhafte Datensätze erscheinen
--    in der Prüfliste der App.
--  * Tarif: wie bei Online-Buchungen der Landingpage (enthaltene Leistungen buchen, ausgeschlossene
--    Standardleistungen stornieren).
--  * Zahlung: „bezahlt“ wird nie auf „offen“ zurückgesetzt (z. B. von Hand in der App bestätigt).
-- Additiv; bestehende Buchungen und Abläufe bleiben unverändert.
-- =============================================================================

alter table public.booking_imports drop constraint if exists booking_imports_channel_check;
alter table public.booking_imports
  add constraint booking_imports_channel_check check (channel in ('manual', 'imap', 'webhook'));

-- Leistungen eines Tarifs auf eine Buchung anwenden (wie die Insert-Trigger für Online-Buchungen)
create or replace function public.apply_tariff_services(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.booking_services (booking_id, service_id, description)
  select b.id, s.id, nullif(btrim(x ->> 'description'), '')
  from public.bookings b
  join public.booking_tariffs t on t.code = b.tariff_code
  cross join lateral jsonb_array_elements(t.included_services) x
  join public.services s on s.code = upper(btrim(x ->> 'code')) and s.active
  where b.id = p_booking_id
  on conflict (booking_id, service_id) do nothing;

  update public.booking_services bs
  set status = 'cancelled'
  from public.bookings b, public.booking_tariffs t, public.services s
  where bs.booking_id = p_booking_id
    and b.id = bs.booking_id
    and t.code = b.tariff_code
    and s.id = bs.service_id
    and s.code = any (t.excluded_services)
    and bs.status = 'active'
    and not exists (select 1 from public.tasks k where k.booking_service_id = bs.id and k.status = 'done');
end;
$$;

revoke all on function public.apply_tariff_services(uuid) from public, anon, authenticated;
grant execute on function public.apply_tariff_services(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- p = { source, external_ref, event ('new'|'change'|'cancel'), booking (für upsert_booking),
--       tariff_code, raw (Originaldatensatz), error (Zuordnung fehlgeschlagen) }
-- Rückgabe { status, booking_id, error, import_id }
-- -----------------------------------------------------------------------------
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

revoke all on function public.sync_external_booking(jsonb) from public, anon, authenticated;
grant execute on function public.sync_external_booking(jsonb) to service_role;

comment on function public.sync_external_booking(jsonb) is
  'Übernimmt eine Buchung aus dem CarHandling-Buchungsbackend (Edge Function booking-sync); nur service_role';
