-- =============================================================================
-- Online-Buchungen der Landingpage in der App (0.33.0)
--  * bookings.tariff_code: gebuchter Tarif (Economy, Cover, Business, Premium) statt nur Notiz
--  * booking_tariffs.included_services: im Tarif enthaltene Leistungen [{code, description}];
--    beim Anlegen einer Buchung mit Tarif werden sie gebucht (→ Aufgaben wie jede Leistung)
--  * Bestehende Online-Buchungen: Tarif und Flugnummern aus der Notiz übernehmen
-- Additiv; Buchungen ohne Tarif (Parkos, Excel, manuell) sind nicht betroffen.
-- =============================================================================

alter table public.bookings
  add column if not exists tariff_code text references public.booking_tariffs (code) on delete set null;

comment on column public.bookings.tariff_code is 'Tarif der Online-Buchung (Landingpage), sonst leer';

alter table public.booking_tariffs
  add column if not exists included_services jsonb not null default '[]'::jsonb
    check (jsonb_typeof(included_services) = 'array');

comment on column public.booking_tariffs.included_services is
  'Im Tarif enthaltene Leistungen [{"code": "SERVICE", "description": "…"}]; Grundreinigung ist ohnehin Standard';

-- [ANNAHME] Premium: Prüfung und CarCover als Servicearbeit; die Reinigung deckt die Standard-Grundreinigung ab
update public.booking_tariffs
set included_services = '[{"code": "SERVICE", "description": "Tarif Premium: Luftdruck und Betriebsflüssigkeiten prüfen, CarCover Satin Indoor"}]'::jsonb,
    updated_at = now()
where code = 'premium' and included_services = '[]'::jsonb;

-- Die App liest Tarife und Widerrufe direkt (Policies bestehen, Rechte ausdrücklich statt über Default-Privileges)
grant select, insert, update, delete on public.booking_tariffs to authenticated;
grant select on public.booking_withdrawals to authenticated;
grant all on public.booking_tariffs, public.booking_withdrawals to service_role;

-- Beim Anlegen einer Buchung mit Tarif: enthaltene Leistungen buchen (unbekannte Codes werden übergangen)
create or replace function public.after_booking_insert_tariff_services()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.booking_services (booking_id, service_id, description)
  select new.id, s.id, nullif(btrim(x ->> 'description'), '')
  from public.booking_tariffs t
  cross join lateral jsonb_array_elements(t.included_services) x
  join public.services s on s.code = upper(btrim(x ->> 'code')) and s.active
  where t.code = new.tariff_code
  on conflict (booking_id, service_id) do nothing;
  return null;
end;
$$;

drop trigger if exists bookings_tariff_services on public.bookings;
create trigger bookings_tariff_services
  after insert on public.bookings
  for each row when (new.tariff_code is not null)
  execute function public.after_booking_insert_tariff_services();

-- Bestehende Online-Buchungen: Tarif aus der ersten Notizzeile „Tarif: <Name>“
update public.bookings b
set tariff_code = t.code
from public.booking_tariffs t
where b.source = 'landing'
  and b.tariff_code is null
  and split_part(b.notes, E'\n', 1) in ('Tarif: ' || t.label, case t.code when 'space' then 'Tarif: Space' end);

-- … und Flugnummern aus „Flug Hinflug: X · Rückflug: Y“ („–“ = nicht angegeben)
update public.bookings b
set flight_out = coalesce(b.flight_out, nullif(m[1], '–')),
    flight_return = coalesce(b.flight_return, nullif(m[2], '–'))
from (
  select id, regexp_match(notes, 'Flug Hinflug: ([^\n·]+?) · Rückflug: ([^\n]+)') as m
  from public.bookings
  where source = 'landing'
) f
where f.id = b.id
  and f.m is not null
  and (b.flight_out is null or b.flight_return is null);
