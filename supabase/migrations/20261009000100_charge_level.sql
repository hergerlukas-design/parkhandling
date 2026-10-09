-- =============================================================================
-- Version 0.16.0: Ladestand im Protokoll wieder erfassen (Elektro und Hybrid)
--   * protocols.charge_level smallint 0–8 (8-Segment-Slider wie der Tankstand)
--   * ersetzt den in 0.14.0 entfernten Akkustand in Prozent (soc_percent)
--
-- Abwärtskompatibel: nur additiv, Tablets < 0.16.0 lassen die Spalte leer.
-- =============================================================================

alter table public.protocols add column if not exists charge_level smallint;

alter table public.protocols drop constraint if exists protocols_charge_level_check;
alter table public.protocols
  add constraint protocols_charge_level_check check (charge_level between 0 and 8);
