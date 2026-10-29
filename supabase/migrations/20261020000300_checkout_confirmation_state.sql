-- =============================================================================
-- Versandstatus der Buchungsbestätigung (Mailausfall nach bezahlter Buchung)
--  * confirmation_sent_at: Zeitpunkt des erfolgreichen Versands
--  * confirmation_error: letzte Fehlermeldung, solange die Bestätigung fehlt
-- =============================================================================

alter table public.booking_checkouts
  add column confirmation_sent_at timestamptz,
  add column confirmation_error text;
