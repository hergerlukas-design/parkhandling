-- =============================================================================
-- 0.31.0 Parkos-Import: Zusatzleistungen aus der Mail als Aufgaben
--
-- Die Preistabelle der Parkos-Mail enthält gebuchte Zusatzleistungen, z. B.
-- „E-Ladeservice (exclusive Stromkosten) € 10,00“. Die App ordnet sie einem
-- Leistungscode zu (LADEN, TANKEN, …) und schickt sie als `services` mit.
-- import_booking_mail ergänzt sie an der Buchung; die Aufgabe entsteht über den
-- bestehenden Trigger an booking_services. Ergänzt wird nur: von Hand gebuchte oder
-- stornierte Leistungen bleiben unverändert (ein erneuter Import holt eine stornierte
-- Leistung nicht zurück). Bei einer Umbuchung werden neue Zusatzleistungen ebenfalls
-- sofort ergänzt; alles andere bleibt wie bisher zur Prüfung.
--
-- Rein additiv (import_booking_mail per create or replace, gleiche Signatur).
-- =============================================================================

create or replace function public.add_import_services(p_booking_id uuid, p_services jsonb)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_added text[];
begin
  if not public.can_write_bookings() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if p_booking_id is null or jsonb_typeof(p_services) is distinct from 'array' then
    return '{}';
  end if;
  perform set_config('app.change_source', 'parkos', true);
  with ins as (
    insert into public.booking_services (booking_id, service_id, price_at_booking, description)
    select distinct on (s.id)
      p_booking_id, s.id,
      coalesce(nullif(x -> 'price', 'null'::jsonb)::text::numeric, s.price),
      nullif(btrim(x ->> 'description'), '')
    from jsonb_array_elements(p_services) x
    join public.services s on s.code = upper(btrim(x ->> 'code')) and s.active
    where jsonb_typeof(x) = 'object'
    on conflict (booking_id, service_id) do nothing
    returning service_id
  )
  select coalesce(array_agg(s.code order by s.code), '{}') into v_added
  from ins join public.services s on s.id = ins.service_id;
  return v_added;
end;
$function$;

revoke execute on function public.add_import_services(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_import_services(uuid, jsonb) to service_role;

create or replace function public.import_booking_mail(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_source text := coalesce(nullif(btrim(p ->> 'source'), ''), 'parkos');
  v_type text := coalesce(nullif(p ->> 'mail_type', ''), 'unknown');
  v_flags text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'flags', '[]'::jsonb))), '{}');
  v_booking jsonb := case when jsonb_typeof(p -> 'booking') = 'object' then p -> 'booking' end;
  v_payout numeric := nullif(p ->> 'portal_payout', '')::numeric;
  v_review_flags constant text[] := array['unknown_product', 'sender_unverified'];
  v_import_id uuid;
  v_status text;
  v_error text;
  v_result jsonb;
  v_booking_id uuid;
  v_added text[] := '{}';
begin
  if not public.can_write_bookings() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if v_type not in ('new', 'change', 'cancel', 'unknown') then
    v_type := 'unknown';
  end if;

  insert into public.booking_imports (
    source, channel, external_ref, mail_type, subject, sender, received_at,
    raw_text, parsed, flags, status
  ) values (
    v_source,
    case when p ->> 'channel' = 'imap' then 'imap' else 'manual' end,
    nullif(btrim(p ->> 'external_ref'), ''),
    v_type,
    left(p ->> 'subject', 500),
    left(p ->> 'sender', 320),
    nullif(p ->> 'received_at', '')::timestamptz,
    left(coalesce(p ->> 'raw_text', ''), 200000),
    coalesce(p -> 'parsed', '{}'::jsonb),
    v_flags,
    'needs_review'
  )
  returning id into v_import_id;

  if v_type <> 'new' then
    v_status := 'needs_review';
    v_error := case v_type
      when 'change' then 'Umbuchung erkannt – bitte prüfen und von Hand übernehmen'
      when 'cancel' then 'Stornierung erkannt – bitte prüfen und von Hand stornieren'
      else 'Mailtyp nicht erkannt'
    end;
    -- Umbuchung: neu gebuchte Zusatzleistungen gleich ergänzen (nur hinzufügen), Rest bleibt zur Prüfung
    if v_type = 'change' then
      select id into v_booking_id from public.bookings
      where source = v_source and external_ref = coalesce(nullif(btrim(v_booking ->> 'external_ref'), ''), nullif(btrim(p ->> 'external_ref'), ''))
        and status <> 'cancelled';
      v_added := public.add_import_services(v_booking_id, p -> 'services');
      if cardinality(v_added) > 0 then
        v_error := v_error || ' (Leistungen ergänzt: ' || array_to_string(v_added, ', ') || ')';
      end if;
    end if;
  elsif v_booking is null then
    v_status := 'needs_review';
    v_error := 'Pflichtangaben fehlen';
  elsif v_flags && v_review_flags then
    v_status := 'needs_review';
    v_error := case
      when 'unknown_product' = any (v_flags) then 'Unbekannte Parkform – Zuordnung in den Einstellungen ergänzen'
      else 'Absender nicht als Parkos bestätigt'
    end;
  else
    begin
      v_result := public.upsert_booking(v_booking, v_source);
      v_booking_id := (v_result ->> 'id')::uuid;
      update public.bookings set
        portal_payout = coalesce(v_payout, portal_payout),
        import_flags = v_flags
      where id = v_booking_id
        and (portal_payout is distinct from coalesce(v_payout, portal_payout) or import_flags is distinct from v_flags);
      v_added := public.add_import_services(v_booking_id, p -> 'services');
      v_status := case
        when v_result ->> 'action' = 'created' then 'imported'
        when v_result ->> 'action' = 'updated' or cardinality(v_added) > 0 then 'updated'
        else 'unchanged'
      end;
    exception when others then
      v_status := 'failed';
      v_error := sqlerrm;
    end;
  end if;

  update public.booking_imports
  set status = v_status, error = v_error, booking_id = v_booking_id
  where id = v_import_id;

  return jsonb_build_object(
    'import_id', v_import_id,
    'status', v_status,
    'booking_id', v_booking_id,
    'error', v_error,
    'unknown_services', coalesce(v_result -> 'unknown_services', '[]'::jsonb),
    'added_services', to_jsonb(v_added)
  );
end;
$function$;
