-- Parkos: Flug-, Sprach- und Transferfelder an Buchungen (additiv, Version 0.22.0)
-- Bereits am 22.10.2026 per Supabase-MCP auf Prod und Staging angewendet; idempotent.
alter table public.bookings
  add column if not exists flight_out text,
  add column if not exists flight_return text,
  add column if not exists return_flight_at timestamptz,
  add column if not exists customer_language text,
  add column if not exists transfer_note text;

comment on column public.bookings.flight_out is 'Flugnummer Hinreise (z. B. LH123)';
comment on column public.bookings.flight_return is 'Flugnummer Rückreise (z. B. LH234)';
comment on column public.bookings.return_flight_at is 'Landung Rückflug am Flughafen; end_at = return_flight_at + settings.return_buffer_minutes';
comment on column public.bookings.customer_language is 'Sprache des Kunden, ISO 639-1 (z. B. de)';
comment on column public.bookings.transfer_note is 'Transfer-Typ laut Portal, Freitext';
