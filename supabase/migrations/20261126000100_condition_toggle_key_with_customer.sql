-- =============================================================================
-- 0.52.0 (Wunsch Lukas 26.11.2026)
--  * protocols.condition_recorded: Karte „Zustand“ (KM-Stand, Antrieb, Tank-/Ladestand, Bedingungen) per Schalter
--    an/aus. Aus = für den Abschluss nicht nötig, erscheint nicht im PDF. Standard an (bisheriges Verhalten).
--    Der Abschluss verlangt den Kilometerstand nur noch bei erfasstem Zustand.
--  * bookings.key_with_customer: Kunde hat den Schlüssel mitgenommen – Fahrzeug steht auf dem Parkplatz,
--    das Schlüsselfach bleibt leer. Erscheint in der Fahrzeugliste (Ansicht booking_list).
-- Additiv und abwärtskompatibel.
-- =============================================================================

alter table public.protocols
  add column if not exists condition_recorded boolean not null default true;

comment on column public.protocols.condition_recorded is
  'Zustand (KM-Stand, Antrieb, Tank-/Ladestand, Bedingungen) erfasst; false = Karte ausgeschaltet, nicht im PDF';

create or replace function public.protect_final_protocol()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'final' then
    if (to_jsonb(new) - array['pdf_media_id', 'sent_at', 'mail_status', 'mail_error',
                              'signature_media_id', 'customer_signature_media_id', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['pdf_media_id', 'sent_at', 'mail_status', 'mail_error',
                              'signature_media_id', 'customer_signature_media_id', 'updated_at']) then
      raise exception 'Protokoll ist abgeschlossen und kann nicht mehr geändert werden' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'final' and old.status = 'draft' then
    new.finalized_at := coalesce(new.finalized_at, now());
    if new.condition_recorded and new.mileage is null then
      raise exception 'Kilometerstand fehlt' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_final_protocol() from public, anon, authenticated;

alter table public.bookings
  add column if not exists key_with_customer boolean not null default false;

comment on column public.bookings.key_with_customer is
  'Kunde hat den Schlüssel mitgenommen: Fahrzeug auf dem Parkplatz, Schlüssel nicht im Schlüsselfach';

-- Fahrzeugliste: Spalte am Ende anhängen (create or replace view erlaubt nur neue Spalten am Ende)
create or replace view public.booking_list
with (security_invoker = true)
as
select
  b.id, b.source, b.external_ref, b.received_at, b.customer_name, b.company, b.customer_email,
  b.customer_phone, b.plate, b.plate_normalized, b.vehicle_model, b.fuel_type, b.persons,
  b.start_at, b.end_at, b.parking_type, b.return_mode, b.status, b.current_location_id,
  b.price_total, b.payment_status, b.portal_token, b.notes, b.created_at, b.updated_at,
  l.code as location_code,
  l.area as location_area,
  l.level as location_level,
  coalesce(t.open_count, 0) as open_task_count,
  coalesce(t.open_charge_fuel_count, 0) as open_charge_fuel_count,
  coalesce(t.chips, '[]'::jsonb) as task_chips,
  b.flight_out, b.flight_return, b.return_flight_at, b.customer_language, b.transfer_note,
  b.portal_payout, b.import_flags,
  b.key_with_customer
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
