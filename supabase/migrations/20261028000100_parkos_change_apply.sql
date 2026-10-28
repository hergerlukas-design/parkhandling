-- =============================================================================
-- 0.32.0 Parkos-Umbuchungen automatisch übernehmen
--
-- Die Umbuchungsmail („Eine Reservierung wurde geändert“) enthält immer den
-- vollständigen neuen Stand. Bisher wurde sie nur zur Prüfung abgelegt; wurde sie
-- dort abgehakt, blieb die Buchung unverändert (z. B. Ankunft 09:00 statt 08:30).
-- Jetzt wird sie wie eine neue Reservierung auf die bestehende Buchung (gleiche
-- Reservierungsnummer) angewendet: Verlauf „Parkos“, Push „Umbuchung“, Shuttle
-- wird neu geplant.
--
-- Felder, die das Personal von Hand geändert hat (Buchungshistorie mit Quelle
-- „manual“), werden nicht überschrieben. Weicht die Mail dort ab, bleibt der Import
-- zur Prüfung offen und nennt die Felder. Notizen übernimmt der Import nie.
-- Unbekannte Reservierung, stornierte/abgeschlossene Buchung, Stornomails und
-- unbekannte Mails bleiben wie bisher zur Prüfung.
--
-- Rein additiv (import_booking_mail per create or replace, gleiche Signatur).
-- =============================================================================

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
  v_existing public.bookings;
  v_merged public.bookings;
  v_manual text[] := '{}';
  v_kept text[] := '{}';
  v_patch jsonb;
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

  -- Umbuchung: Buchung zur Reservierungsnummer suchen
  if v_type = 'change' and v_booking is not null then
    select * into v_existing from public.bookings
    where source = v_source
      and external_ref = coalesce(nullif(btrim(v_booking ->> 'external_ref'), ''), nullif(btrim(p ->> 'external_ref'), ''))
    for update;
  end if;

  if v_type not in ('new', 'change') then
    v_status := 'needs_review';
    v_error := case v_type
      when 'cancel' then 'Stornierung erkannt – bitte prüfen und von Hand stornieren'
      else 'Mailtyp nicht erkannt'
    end;
  elsif v_booking is null then
    v_status := 'needs_review';
    v_error := 'Pflichtangaben fehlen';
  elsif v_flags && v_review_flags then
    v_status := 'needs_review';
    v_error := case
      when 'unknown_product' = any (v_flags) then 'Unbekannte Parkform – Zuordnung in den Einstellungen ergänzen'
      else 'Absender nicht als Parkos bestätigt'
    end;
  elsif v_type = 'change' and v_existing.id is null then
    v_status := 'needs_review';
    v_error := 'Umbuchung zu einer unbekannten Reservierung – bitte prüfen';
  elsif v_type = 'change' and v_existing.status in ('cancelled', 'completed') then
    v_status := 'needs_review';
    v_error := 'Umbuchung zu einer stornierten oder abgeschlossenen Buchung – bitte prüfen';
  else
    begin
      if v_type = 'change' then
        -- Von Hand geänderte Felder (Buchungshistorie, Quelle „manual“) behält die Buchung
        v_manual := array(
          select distinct k from public.booking_history h, jsonb_object_keys(h.changed_fields) k
          where h.booking_id = v_existing.id and h.source = 'manual'
        );
        v_merged := jsonb_populate_record(v_existing, v_booking);
        v_kept := array(
          select k from unnest(v_manual) k
          where v_booking ? k and to_jsonb(v_merged) -> k is distinct from to_jsonb(v_existing) -> k
          order by k
        );
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_patch
        from jsonb_each(v_booking) e
        where e.key <> all (v_manual) and e.key not in ('notes', 'services', 'id');
        v_booking := v_patch || jsonb_build_object('id', v_existing.id);
      end if;
      v_result := public.upsert_booking(v_booking, v_source);
      v_booking_id := (v_result ->> 'id')::uuid;
      update public.bookings set
        portal_payout = coalesce(v_payout, portal_payout),
        import_flags = v_flags
      where id = v_booking_id
        and (portal_payout is distinct from coalesce(v_payout, portal_payout) or import_flags is distinct from v_flags);
      v_added := public.add_import_services(v_booking_id, p -> 'services');
      v_status := case
        when cardinality(v_kept) > 0 then 'needs_review'
        when v_result ->> 'action' = 'created' then 'imported'
        when v_result ->> 'action' = 'updated' or cardinality(v_added) > 0 then 'updated'
        else 'unchanged'
      end;
      if cardinality(v_kept) > 0 then
        v_error := 'Umbuchung übernommen, außer von Hand geänderten Feldern: ' || array_to_string(v_kept, ', ')
          || ' – bitte prüfen';
      end if;
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
