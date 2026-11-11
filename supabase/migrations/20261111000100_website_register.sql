-- =============================================================================
-- Buchungen aus dem Website-Rechner im Dashboard (0.34.0)
--  * Preismodell der Website: Grundpreis bis 5 Tage + Preis je weiterem Tag
--    (booking_tariffs.base_price / extra_day_price). Die Spalten price_week/holiday/month
--    bleiben bestehen, werden von der Online-Buchung aber nicht mehr genutzt.
--  * Tarif „space“ heißt „CarCover“ (Code bleibt space; der Rechner sendet carcover als Alias)
--  * area_full(start, end, parking_type): Bereich im Zeitraum voll? Wie indoor_full, für
--    Halle (indoor → hall), Außen A mit Plane (outdoor_cover → outdoor_a) und
--    Außen B ohne Plane (outdoor → outdoor_b). indoor_full bleibt unverändert.
-- Additiv; bookings.source = 'website' braucht keine Schemaänderung (freier Text).
-- =============================================================================

alter table public.booking_tariffs
  add column if not exists base_price numeric(10, 2) not null default 0 check (base_price >= 0),
  add column if not exists extra_day_price numeric(10, 2) not null default 0 check (extra_day_price >= 0);

comment on column public.booking_tariffs.base_price is 'Grundpreis brutto in EUR für bis zu 5 Tage';
comment on column public.booking_tariffs.extra_day_price is 'Preis brutto in EUR je weiterem Tag ab dem 6. Tag';
comment on column public.booking_tariffs.price_week is 'Nicht mehr genutzt (altes Modell nach Dauerklassen)';
comment on column public.booking_tariffs.price_holiday is 'Nicht mehr genutzt (altes Modell nach Dauerklassen)';
comment on column public.booking_tariffs.price_month is 'Nicht mehr genutzt (altes Modell nach Dauerklassen)';

update public.booking_tariffs t
set base_price = v.base_price, extra_day_price = v.extra_day_price, updated_at = now()
from (values
  ('economy', 49.00, 7.50),
  ('space', 59.00, 9.00),
  ('business', 89.00, 12.50),
  ('premium', 98.00, 14.00)
) as v (code, base_price, extra_day_price)
where t.code = v.code and t.base_price = 0 and t.extra_day_price = 0;

-- Nur den Ursprungsnamen ersetzen; ein per Admin geänderter Name bleibt
update public.booking_tariffs
set label = 'CarCover', updated_at = now()
where code = 'space' and label in ('Cover', 'Space');

create or replace function public.area_full(p_start timestamptz, p_end timestamptz, p_parking_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with capacity as (
    select count(*)::int as places
    from public.locations
    where area = case p_parking_type
                   when 'indoor' then 'hall'
                   when 'outdoor_cover' then 'outdoor_a'
                   when 'outdoor' then 'outdoor_b'
                 end
      and active and status <> 'blocked'
  ),
  overlapping as (
    select start_at, end_at
    from public.bookings
    where parking_type = p_parking_type
      and status not in ('cancelled', 'completed')
      and start_at < p_end
      and end_at > p_start
  ),
  -- Die Belegung steigt nur zu Beginn des Zeitraums oder bei einer Anreise darin
  checkpoints as (
    select p_start as t
    union
    select start_at from overlapping where start_at > p_start
  )
  select coalesce(
    (select max(n) from (
       select count(o.*) as n
       from checkpoints c
       left join overlapping o on o.start_at <= c.t and o.end_at > c.t
       group by c.t
     ) peaks),
    0
  ) >= (select places from capacity)
$$;

revoke all on function public.area_full(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.area_full(timestamptz, timestamptz, text) to service_role;

comment on function public.area_full(timestamptz, timestamptz, text) is
  'Bereich (indoor/outdoor_cover/outdoor) im Zeitraum voll? Für Online-Buchung und Website-Rechner. Unbekannter Bereich gilt als voll.';
