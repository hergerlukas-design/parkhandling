-- =============================================================================
-- Hallenbelegung für die Online-Buchung (Review-Notizen #5/#6, landing 0.10.0)
--  * indoor_full(start, end): true, wenn die Halle im Zeitraum zu irgendeinem Zeitpunkt voll ist
--  * Kapazität = aktive Hallenplätze, die nicht gesperrt sind
--  * Belegung = Indoor-Buchungen, die nicht storniert oder abgeschlossen sind und sich mit dem
--    Zeitraum überschneiden; gezählt wird die höchste gleichzeitige Belegung
--  * Aufruf nur über den service_role (Edge Function booking-checkout)
-- =============================================================================

create or replace function public.indoor_full(p_start timestamptz, p_end timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with capacity as (
    select count(*)::int as places
    from public.locations
    where area = 'hall' and active and status <> 'blocked'
  ),
  overlapping as (
    select start_at, end_at
    from public.bookings
    where parking_type = 'indoor'
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

revoke all on function public.indoor_full(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.indoor_full(timestamptz, timestamptz) to service_role;

comment on function public.indoor_full(timestamptz, timestamptz) is
  'Halle im Zeitraum voll? Für die Online-Buchung (Ausverkauft-Hinweis bei Business/Premium).';
