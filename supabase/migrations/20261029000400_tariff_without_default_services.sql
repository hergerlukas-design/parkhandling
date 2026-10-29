-- =============================================================================
-- Tarife ohne Standardleistung (0.33.0)
--  * Economy enthält keine Reinigung: Online-Buchungen im Tarif Economy bekommen keine Grundreinigung
--  * booking_tariffs.excluded_services: Codes von Standardleistungen, die der Tarif nicht enthält
--  * after_booking_insert_defaults lässt diese Leistungen aus (create or replace, gleiche Signatur)
--  * Bestehende Economy-Buchungen: offene Grundreinigung stornieren (Aufgabe wird per Trigger storniert)
-- Buchungen ohne Tarif (Parkos, Excel, manuell) behalten die Grundreinigung wie bisher.
-- =============================================================================

alter table public.booking_tariffs
  add column if not exists excluded_services text[] not null default '{}';

comment on column public.booking_tariffs.excluded_services is
  'Standardleistungen (services.is_default), die der Tarif nicht enthält, z. B. {GRUND}';

update public.booking_tariffs
set excluded_services = '{GRUND}', updated_at = now()
where code = 'economy' and excluded_services = '{}';

create or replace function public.after_booking_insert_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.booking_services (booking_id, service_id, price_at_booking)
  select new.id, s.id, s.price
  from public.services s
  where s.is_default and s.active
    and not exists (
      select 1 from public.booking_tariffs t
      where t.code = new.tariff_code and s.code = any (t.excluded_services)
    )
  on conflict (booking_id, service_id) do nothing;
  return null;
end;
$$;

-- Bereits angelegte Online-Buchungen im Tarif: ausgeschlossene Standardleistung stornieren,
-- solange die Buchung läuft und die Aufgabe nicht erledigt ist
update public.booking_services bs
set status = 'cancelled'
from public.bookings b, public.booking_tariffs t, public.services s
where b.id = bs.booking_id
  and t.code = b.tariff_code
  and s.id = bs.service_id
  and s.code = any (t.excluded_services)
  and bs.status = 'active'
  and b.status not in ('completed', 'cancelled')
  and not exists (
    select 1 from public.tasks k where k.booking_service_id = bs.id and k.status = 'done'
  );
