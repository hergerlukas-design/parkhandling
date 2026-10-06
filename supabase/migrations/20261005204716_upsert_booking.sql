-- =============================================================================
-- Buchungsschnittstelle: idempotentes Anlegen/Aktualisieren (Arbeitsanweisung Abschnitt 4)
-- Einziger Schreibweg für alle Adapter (manuell, Excel/CSV, später Portal).
--  * Idempotenz über (source, external_ref); ohne external_ref wird immer neu angelegt
--  * "id" im JSON: gezielte Bearbeitung einer bestehenden Buchung (manuelles Bearbeiten im UI)
--  * Umbuchung: nur mitgelieferte Felder werden übernommen, Änderungen landen per
--    Trigger in booking_history (Quelle = source)
--  * Leistungen: ["CODE", …] oder [{"code": "ZUSATZ", "price": 45.5, "description": "…"}];
--    neue werden gebucht (Aufgaben per Trigger), fehlende storniert – Standardleistungen bleiben
--  * "cancelled": true storniert die Buchung (nie löschen)
-- Läuft mit den Rechten des Aufrufers (RLS greift).
-- =============================================================================

create or replace function public.upsert_booking(p_booking jsonb, p_source text default 'manual')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  p jsonb := coalesce(p_booking, '{}'::jsonb);
  v_ref text := nullif(btrim(p ->> 'external_ref'), '');
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual');
  v_cancel boolean := coalesce((p ->> 'cancelled')::boolean, false);
  -- Felder, die ein Adapter setzen darf (Status, Ort, Token usw. bleiben App-intern)
  v_cols constant text[] := array[
    'received_at', 'customer_name', 'company', 'customer_email', 'customer_phone', 'plate',
    'vehicle_model', 'fuel_type', 'persons', 'start_at', 'end_at', 'parking_type', 'return_mode',
    'notes', 'price_total', 'payment_status'
  ];
  v_fields jsonb;
  existing public.bookings;
  merged public.bookings;
  v_id uuid;
  v_action text;
  v_services jsonb;
  v_codes text[] := '{}';
  v_unknown text[] := '{}';
  v_history_before integer := 0;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;

  -- Quelle für booking_history (nur für diese Transaktion)
  perform set_config('app.change_source', v_source, true);

  -- Erlaubte Felder übernehmen, leere Texte als null
  select coalesce(jsonb_object_agg(k, case when p -> k = '""'::jsonb then 'null'::jsonb else p -> k end), '{}'::jsonb)
  into v_fields
  from unnest(v_cols) k
  where p ? k;

  if p ? 'id' then
    select * into existing from public.bookings where id = (p ->> 'id')::uuid for update;
    if existing.id is null then
      raise exception 'Buchung % nicht gefunden', p ->> 'id' using errcode = 'P0002';
    end if;
  elsif v_ref is not null then
    select * into existing from public.bookings
    where source = v_source and external_ref = v_ref
    for update;
  end if;

  if existing.id is null then
    merged := jsonb_populate_record(
      null::public.bookings,
      '{"persons": 1, "return_mode": "shuttle", "payment_status": "open"}'::jsonb
        || jsonb_strip_nulls(v_fields)
    );
    insert into public.bookings (
      source, external_ref, received_at, customer_name, company, customer_email, customer_phone,
      plate, vehicle_model, fuel_type, persons, start_at, end_at, parking_type, return_mode, notes,
      price_total, payment_status, status
    ) values (
      v_source, v_ref, coalesce(merged.received_at, now()), merged.customer_name, merged.company,
      merged.customer_email, merged.customer_phone, merged.plate, merged.vehicle_model,
      merged.fuel_type, merged.persons, merged.start_at, merged.end_at, merged.parking_type,
      merged.return_mode, merged.notes, merged.price_total, merged.payment_status,
      case when v_cancel then 'cancelled' else 'booked' end
    )
    returning id into v_id;
    v_action := 'created';
  else
    v_id := existing.id;
    select count(*) into v_history_before from public.booking_history where booking_id = v_id;
    merged := jsonb_populate_record(existing, v_fields);

    if (p ? 'id' and p ? 'external_ref' and v_ref is distinct from existing.external_ref)
       or row(
         merged.received_at, merged.customer_name, merged.company, merged.customer_email,
         merged.customer_phone, merged.plate, merged.vehicle_model, merged.fuel_type, merged.persons,
         merged.start_at, merged.end_at, merged.parking_type, merged.return_mode, merged.notes,
         merged.price_total, merged.payment_status
       ) is distinct from row(
         existing.received_at, existing.customer_name, existing.company, existing.customer_email,
         existing.customer_phone, existing.plate, existing.vehicle_model, existing.fuel_type,
         existing.persons, existing.start_at, existing.end_at, existing.parking_type,
         existing.return_mode, existing.notes, existing.price_total, existing.payment_status
       )
       or (v_cancel and existing.status not in ('cancelled', 'completed'))
    then
      update public.bookings set
        external_ref = case when p ? 'id' and p ? 'external_ref' then v_ref else external_ref end,
        received_at = merged.received_at,
        customer_name = merged.customer_name,
        company = merged.company,
        customer_email = merged.customer_email,
        customer_phone = merged.customer_phone,
        plate = merged.plate,
        vehicle_model = merged.vehicle_model,
        fuel_type = merged.fuel_type,
        persons = coalesce(merged.persons, existing.persons),
        start_at = merged.start_at,
        end_at = merged.end_at,
        parking_type = merged.parking_type,
        return_mode = coalesce(merged.return_mode, existing.return_mode),
        notes = merged.notes,
        price_total = merged.price_total,
        payment_status = coalesce(merged.payment_status, existing.payment_status),
        status = case when v_cancel and status not in ('cancelled', 'completed') then 'cancelled' else status end
      where id = v_id;
    end if;
  end if;

  -- Leistungen abgleichen (nur wenn der Adapter Leistungen liefert)
  if jsonb_typeof(p -> 'services') = 'array' then
    select coalesce(jsonb_agg(
      case jsonb_typeof(e)
        when 'string' then jsonb_build_object('code', upper(btrim(e #>> '{}')))
        else jsonb_build_object(
          'code', upper(btrim(e ->> 'code')),
          'price', e -> 'price',
          'description', nullif(btrim(e ->> 'description'), '')
        )
      end), '[]'::jsonb)
    into v_services
    from jsonb_array_elements(p -> 'services') e
    where coalesce(btrim(case jsonb_typeof(e) when 'string' then e #>> '{}' else e ->> 'code' end), '') <> '';

    v_codes := array(select distinct x ->> 'code' from jsonb_array_elements(v_services) x);
    v_unknown := array(
      select c from unnest(v_codes) c
      where not exists (select 1 from public.services s where s.code = c and s.active)
    );

    -- Neue Leistungen buchen (Preis: explizit > Katalog)
    insert into public.booking_services (booking_id, service_id, price_at_booking, description)
    select distinct on (s.id)
      v_id, s.id,
      coalesce(nullif(x -> 'price', 'null'::jsonb)::text::numeric, s.price),
      x ->> 'description'
    from jsonb_array_elements(v_services) x
    join public.services s on s.code = x ->> 'code' and s.active
    on conflict (booking_id, service_id) do nothing;

    -- Bestehende: stornierte reaktivieren; Preis/Beschreibung nur bei expliziter Angabe ändern,
    -- damit ein Re-Import ohne Preis individuell vereinbarte Preise nicht überschreibt
    update public.booking_services bs set
      status = 'active',
      price_at_booking = coalesce(nullif(x -> 'price', 'null'::jsonb)::text::numeric, bs.price_at_booking),
      description = coalesce(x ->> 'description', bs.description)
    from jsonb_array_elements(v_services) x
    join public.services s on s.code = x ->> 'code' and s.active
    where bs.booking_id = v_id
      and bs.service_id = s.id
      and (
        bs.status = 'cancelled'
        or (x ? 'price' and x -> 'price' <> 'null'::jsonb
            and bs.price_at_booking is distinct from (x -> 'price')::text::numeric)
        or (x ->> 'description' is not null and bs.description is distinct from x ->> 'description')
      );

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
