-- =============================================================================
-- Fahrzeugliste: eine Abfrage liefert Buchung, Ort, Leistungs-Chips und Filterzahlen.
-- security_invoker = true → RLS der zugrunde liegenden Tabellen gilt für den Aufrufer.
-- =============================================================================

create or replace view public.booking_list
with (security_invoker = true)
as
select
  b.*,
  l.code as location_code,
  l.area as location_area,
  l.level as location_level,
  coalesce(t.open_count, 0) as open_task_count,
  coalesce(t.open_charge_fuel_count, 0) as open_charge_fuel_count,
  coalesce(t.chips, '[]'::jsonb) as task_chips
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

grant select on public.booking_list to authenticated;
revoke all on public.booking_list from anon;
