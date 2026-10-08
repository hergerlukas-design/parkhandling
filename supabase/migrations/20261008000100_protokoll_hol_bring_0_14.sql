-- =============================================================================
-- Version 0.14.0 (Issue #7, Nachtrag zur Arbeitsanweisung vom 08.10.2026)
--   * Vallet entfällt → Hol- & Bringservice (bookings.return_mode = pickup_delivery)
--   * transport_jobs.type 'vallet' entfällt
--   * protocols.mileage numeric(10,1) (Dezimalkomma in der UI, Punkt in der DB)
--   * protocols.fuel_level smallint 0–8 (8-Segment-Slider), vorher 0–100 Prozent
--   * protocols.soc_percent (Akkustand) entfällt
--
-- Abwärtskompatibel: 'vallet' bleibt in bookings.return_mode zulässig, ein Trigger
-- schreibt es direkt in 'pickup_delivery' um, damit ältere Tablets (< 0.14.0)
-- weiterhin speichern können. Die Tabelle transport_jobs hat in Phase 1 keine UI.
-- =============================================================================

-- 1) Buchungen: bestehende Vallet-Einträge umschreiben, künftige Schreibvorgänge normalisieren
update public.bookings set return_mode = 'pickup_delivery' where return_mode = 'vallet';

create or replace function public.normalize_return_mode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Vallet ist entfallen; Tablets mit Version < 0.14.0 schreiben weiterhin 'vallet'
  if new.return_mode = 'vallet' then
    new.return_mode := 'pickup_delivery';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_normalize_return_mode on public.bookings;
create trigger bookings_normalize_return_mode
  before insert or update of return_mode on public.bookings
  for each row execute function public.normalize_return_mode();

revoke execute on function public.normalize_return_mode() from public, anon, authenticated;

-- 2) Shuttle-Fahrten: Typ 'vallet' entfällt (Phase 1 ohne UI, Testdaten)
delete from public.transport_jobs where type = 'vallet';
alter table public.transport_jobs drop constraint if exists transport_jobs_type_check;
alter table public.transport_jobs
  add constraint transport_jobs_type_check check (type in ('shuttle_slot', 'premium_on_demand'));

-- 3) Arbeitsort-Bezeichnung ohne „Vallet“ (Code T-VAL bleibt unverändert)
update public.locations set name = 'Hol- & Bringservice unterwegs'
where code = 'T-VAL' and name = 'Vallet unterwegs';

-- 4) Kilometerstand mit einer Nachkommastelle
alter table public.protocols
  alter column mileage type numeric(10, 1) using mileage::numeric(10, 1);

-- 5) Tankstand: Prozentwerte (10, 25, 50, 75, 100) auf 8 Segmente umrechnen.
--    Die Schutz-Trigger für finale Protokolle werden nur für diese Umrechnung kurz
--    ausgeschaltet; Werte finaler Protokolle werden also ebenfalls auf Segmente gebracht.
alter table public.protocols disable trigger protocols_protect_final;
update public.protocols
   set fuel_level = round(fuel_level * 8 / 100.0)::smallint
 where fuel_level is not null;
alter table public.protocols enable trigger protocols_protect_final;

alter table public.protocols drop constraint if exists protocols_fuel_level_check;
alter table public.protocols
  add constraint protocols_fuel_level_check check (fuel_level between 0 and 8);

-- 6) Akkustand entfällt (die App schreibt die Spalte seit 0.14.0 nicht mehr)
alter table public.protocols drop column if exists soc_percent;
