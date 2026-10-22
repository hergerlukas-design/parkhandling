-- =============================================================================
-- Parkos-Mailimport (0.23.0), gemeinsam für manuellen Import und späteren IMAP-Abruf.
-- Additiv: neue Spalten, neue Tabelle booking_imports, neue Funktionen.
-- =============================================================================

-- Buchungen: Auszahlung laut Portal und Prüf-Hinweise aus dem Import
alter table public.bookings
  add column if not exists portal_payout numeric(10, 2) check (portal_payout is null or portal_payout >= 0),
  add column if not exists import_flags text[] not null default '{}';

comment on column public.bookings.portal_payout is 'Auszahlung an ParkHandling laut Portal (Parkos: „Gesamtumsatz ParkHandling Park&Fly“)';
comment on column public.bookings.import_flags is 'Hinweise aus dem Import, z. B. plate_unverified, phone_missing';

-- Wer Buchungen schreiben darf: angemeldete Mitarbeiter oder der Service-Zugang (IMAP-Abruf)
create or replace function public.can_write_bookings()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_staff() or coalesce(auth.role(), '') = 'service_role'
$function$;

revoke execute on function public.can_write_bookings() from public, anon;
grant execute on function public.can_write_bookings() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Protokoll jeder eingelesenen Mail (nur Text, kein HTML-Bildinhalt)
-- -----------------------------------------------------------------------------
create table if not exists public.booking_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'parkos',
  channel text not null default 'manual' check (channel in ('manual', 'imap')),
  external_ref text,
  mail_type text not null default 'unknown' check (mail_type in ('new', 'change', 'cancel', 'unknown')),
  subject text,
  sender text,
  received_at timestamptz,
  raw_text text not null check (length(raw_text) <= 200000),
  parsed jsonb not null default '{}'::jsonb,
  flags text[] not null default '{}',
  status text not null check (status in ('imported', 'updated', 'unchanged', 'needs_review', 'failed', 'resolved')),
  error text,
  booking_id uuid references public.bookings (id) on delete set null,
  created_by uuid default auth.uid(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.booking_imports is 'Eingelesene Portal-Mails (Rohtext + Parse-Ergebnis); Prüfliste für Umbuchungen, Stornos und Fehler';

create index if not exists booking_imports_status_idx on public.booking_imports (status, created_at desc);
create index if not exists booking_imports_ref_idx on public.booking_imports (source, external_ref);
create index if not exists booking_imports_booking_idx on public.booking_imports (booking_id);

drop trigger if exists set_updated_at on public.booking_imports;
create trigger set_updated_at before update on public.booking_imports
  for each row execute function public.set_updated_at();

alter table public.booking_imports enable row level security;

drop policy if exists staff_select on public.booking_imports;
create policy staff_select on public.booking_imports
  for select to authenticated using ((select public.is_staff()));
drop policy if exists admin_all on public.booking_imports;
create policy admin_all on public.booking_imports
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.booking_imports to authenticated;
grant all on public.booking_imports to service_role;
revoke all on public.booking_imports from anon;

-- -----------------------------------------------------------------------------
-- Einstellungen (Daten statt Code)
-- -----------------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('return_buffer_minutes', '60',
   'Puffer zwischen Landung Rückflug und Abholung am Platz (Minuten); end_at = Landung + Puffer'),
  ('parkos_product_map',
   '[{"parkos_label": "Shuttle-Transfer (nicht überdacht)", "parking_type": "outdoor", "return_mode": "shuttle"}]',
   'Zuordnung Parkos-Parkform → Stellplatzart (parking_type) und Rückgabe (return_mode)')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- upsert_booking: auch für den Service-Zugang (IMAP-Abruf) freigegeben
-- -----------------------------------------------------------------------------
create or replace function public.upsert_booking(p_booking jsonb, p_source text default 'manual')
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  p jsonb := coalesce(p_booking, '{}'::jsonb);
  v_ref text := nullif(btrim(p ->> 'external_ref'), '');
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual');
  v_cancel boolean := coalesce((p ->> 'cancelled')::boolean, false);
  v_cols constant text[] := array[
    'received_at', 'customer_name', 'company', 'customer_email', 'customer_phone', 'plate',
    'vehicle_model', 'fuel_type', 'persons', 'start_at', 'end_at', 'parking_type', 'return_mode',
    'notes', 'price_total', 'payment_status',
    'flight_out', 'flight_return', 'return_flight_at', 'customer_language', 'transfer_note'
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
  if not public.can_write_bookings() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;

  perform set_config('app.change_source', v_source, true);

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
      price_total, payment_status, status,
      flight_out, flight_return, return_flight_at, customer_language, transfer_note
    ) values (
      v_source, v_ref, coalesce(merged.received_at, now()), merged.customer_name, merged.company,
      merged.customer_email, merged.customer_phone, merged.plate, merged.vehicle_model,
      merged.fuel_type, merged.persons, merged.start_at, merged.end_at, merged.parking_type,
      merged.return_mode, merged.notes, merged.price_total, merged.payment_status,
      case when v_cancel then 'cancelled' else 'booked' end,
      merged.flight_out, merged.flight_return, merged.return_flight_at, merged.customer_language,
      merged.transfer_note
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
         merged.price_total, merged.payment_status,
         merged.flight_out, merged.flight_return, merged.return_flight_at, merged.customer_language,
         merged.transfer_note
       ) is distinct from row(
         existing.received_at, existing.customer_name, existing.company, existing.customer_email,
         existing.customer_phone, existing.plate, existing.vehicle_model, existing.fuel_type,
         existing.persons, existing.start_at, existing.end_at, existing.parking_type,
         existing.return_mode, existing.notes, existing.price_total, existing.payment_status,
         existing.flight_out, existing.flight_return, existing.return_flight_at,
         existing.customer_language, existing.transfer_note
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
        flight_out = merged.flight_out,
        flight_return = merged.flight_return,
        return_flight_at = merged.return_flight_at,
        customer_language = merged.customer_language,
        transfer_note = merged.transfer_note,
        status = case when v_cancel and status not in ('cancelled', 'completed') then 'cancelled' else status end
      where id = v_id;
    end if;
  end if;

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

    insert into public.booking_services (booking_id, service_id, price_at_booking, description)
    select distinct on (s.id)
      v_id, s.id,
      coalesce(nullif(x -> 'price', 'null'::jsonb)::text::numeric, s.price),
      x ->> 'description'
    from jsonb_array_elements(v_services) x
    join public.services s on s.code = x ->> 'code' and s.active
    on conflict (booking_id, service_id) do nothing;

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
$function$;

grant execute on function public.upsert_booking(jsonb, text) to service_role;

-- -----------------------------------------------------------------------------
-- Eine Portal-Mail verarbeiten. Aufrufer (Import-Dialog oder IMAP-Abruf) liefern das
-- Parse-Ergebnis; diese Funktion protokolliert, entscheidet und legt die Buchung an.
--   p = { source, channel, mail_type, subject, sender, received_at, external_ref,
--         raw_text, parsed, flags[], booking (BookingInput | null), portal_payout }
-- Neue Reservierungen ohne Prüf-Hinweis → upsert_booking.
-- Umbuchung, Storno, unbekannter Typ, fehlende Daten, unbekannte Parkform,
-- nicht geprüfter Absender → needs_review, Buchung bleibt unverändert.
-- -----------------------------------------------------------------------------
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
      v_status := case v_result ->> 'action'
        when 'created' then 'imported'
        when 'updated' then 'updated'
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
    'unknown_services', coalesce(v_result -> 'unknown_services', '[]'::jsonb)
  );
end;
$function$;

revoke execute on function public.import_booking_mail(jsonb) from public, anon;
grant execute on function public.import_booking_mail(jsonb) to authenticated, service_role;

-- Prüfliste: Eintrag als erledigt markieren (Mitarbeiter dürfen das, sonst nur Admin)
create or replace function public.resolve_booking_import(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  update public.booking_imports
  set status = 'resolved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = p_id and status in ('needs_review', 'failed');
  if not found then
    raise exception 'Import % nicht offen', p_id using errcode = 'P0002';
  end if;
end;
$function$;

revoke execute on function public.resolve_booking_import(uuid, text) from public, anon;
grant execute on function public.resolve_booking_import(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Fahrzeugliste mit den neuen Buchungsspalten (b.* wird neu aufgelöst)
-- -----------------------------------------------------------------------------
drop view if exists public.booking_list;
create view public.booking_list
with (security_invoker = true)
as
select
  b.*,
  l.code as location_code,
  l.area as location_area,
  l.level as location_level,
  coalesce(t.open_count, 0) as open_task_count,
  coalesce(t.open_charge_fuel_count, 0) as open_charge_fuel_count,
  coalesce(t.chips, '[]'::jsonb) as task_chips
from public.bookings b
left join public.locations l on l.id = b.current_location_id
left join lateral (
  select
    count(*) filter (where tk.status in ('open', 'in_progress')) as open_count,
    count(*) filter (where tk.status in ('open', 'in_progress') and tk.type in ('charge', 'fuel')) as open_charge_fuel_count,
    jsonb_agg(
      jsonb_build_object('title', tk.title, 'status', tk.status, 'type', tk.type, 'is_default', coalesce(s.is_default, false))
      order by coalesce(s.sort_order, 999), tk.created_at
    ) as chips
  from public.tasks tk
  left join public.services s on s.id = tk.service_id
  where tk.booking_id = b.id and tk.status <> 'cancelled' and tk.type <> 'relocate'
) t on true;

grant select on public.booking_list to authenticated;
revoke all on public.booking_list from anon;
