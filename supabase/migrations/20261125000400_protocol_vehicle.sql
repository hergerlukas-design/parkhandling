-- =============================================================================
-- Protokoll: Kennzeichen und Antrieb statt FIN (0.42.0, Wunsch Lukas 25.11.2026)
--  * protocols.plate: Kennzeichen (vorbelegt aus der Buchung, im Protokoll korrigierbar)
--  * protocols.fuel_type: Antrieb (Verbrenner, Hybrid, Elektro), im Protokoll gewählt
--  * Abweichungen übernimmt die Buchung (Trigger; Historie über bookings_history, Quelle „protocol“), damit Dashboard,
--    Annahme- und Übergabeprotokoll übereinstimmen
--  * Ladestand 0–100 % (Regler; vorher 1–100 als Textfeld)
--  * protocols.vin bleibt für ältere Protokolle bestehen, wird nicht mehr erfasst
-- =============================================================================

alter table public.protocols
  add column if not exists plate text,
  add column if not exists fuel_type text;

alter table public.protocols drop constraint if exists protocols_fuel_type_check;
alter table public.protocols
  add constraint protocols_fuel_type_check check (fuel_type is null or fuel_type in ('combustion', 'electric', 'hybrid'));

alter table public.protocols drop constraint if exists protocols_charge_level_check;
alter table public.protocols
  add constraint protocols_charge_level_check check (charge_level between 0 and 100);

comment on column public.protocols.plate is 'Kennzeichen laut Protokoll (aus der Buchung vorbelegt, korrigierbar)';
comment on column public.protocols.fuel_type is 'Antrieb laut Protokoll: combustion (Verbrenner), hybrid, electric';
comment on column public.protocols.charge_level is 'Ladestand in Prozent (0–100), Elektro und Hybrid';

-- Kennzeichen und Antrieb aus dem Protokoll in die Buchung übernehmen
create or replace function public.sync_protocol_vehicle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text := current_setting('app.change_source', true);
  v_plate text := nullif(upper(regexp_replace(btrim(coalesce(new.plate, '')), '\s+', ' ', 'g')), '');
begin
  if v_plate is null and new.fuel_type is null then
    return new;
  end if;
  -- Historie per Trigger bookings_history, Quelle „protocol“
  perform set_config('app.change_source', 'protocol', true);
  update public.bookings
  set plate = coalesce(v_plate, plate), fuel_type = coalesce(new.fuel_type, fuel_type)
  where id = new.booking_id
    and ((v_plate is not null and v_plate is distinct from plate)
         or (new.fuel_type is not null and new.fuel_type is distinct from fuel_type));
  perform set_config('app.change_source', coalesce(v_prev, ''), true);
  return new;
end;
$$;

revoke execute on function public.sync_protocol_vehicle() from public, anon, authenticated;

drop trigger if exists protocols_sync_vehicle on public.protocols;
create trigger protocols_sync_vehicle
  after insert or update of plate, fuel_type on public.protocols
  for each row execute function public.sync_protocol_vehicle();
