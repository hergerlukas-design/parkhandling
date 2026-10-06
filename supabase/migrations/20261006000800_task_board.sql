-- =============================================================================
-- Aufgaben-Board (Abschnitt 7 „Aufgaben“): wer arbeitet woran, Fotos je Aufgabe
-- Additiv und abwärtskompatibel zu 0.7.0.
-- =============================================================================

alter table public.tasks
  add column if not exists started_by uuid references auth.users (id) on delete set null,
  add column if not exists started_at timestamptz;

create index if not exists tasks_started_by_idx on public.tasks (started_by);

-- Erledigt/Begonnen automatisch mit Person und Zeit stempeln
create or replace function public.before_task_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.done_at := coalesce(new.done_at, now());
    new.done_by := coalesce(new.done_by, auth.uid());
  elsif new.status <> 'done' then
    new.done_at := null;
    new.done_by := null;
  end if;
  if new.status = 'in_progress' and (tg_op = 'INSERT' or old.status <> 'in_progress') then
    new.started_at := coalesce(new.started_at, now());
    new.started_by := coalesce(new.started_by, auth.uid());
  elsif new.status = 'open' then
    new.started_at := null;
    new.started_by := null;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Board-Ansicht: Aufgabe + Fahrzeug + Ort + Leistung + Personen + Fotoanzahl
-- -----------------------------------------------------------------------------
create or replace view public.task_board
with (security_invoker = true)
as
select
  t.*,
  b.plate,
  b.vehicle_model,
  b.status as booking_status,
  b.end_at as booking_end_at,
  b.fuel_type,
  l.code as location_code,
  s.code as service_code,
  s.category as service_category,
  rb.plate as related_plate,
  ps.display_name as started_by_name,
  pd.display_name as done_by_name,
  (select count(*)::int from public.media m
     where m.owner_type = 'task' and m.owner_id = t.id and m.kind = 'photo' and m.uploaded_at is not null) as photo_count
from public.tasks t
join public.bookings b on b.id = t.booking_id
left join public.locations l on l.id = b.current_location_id
left join public.services s on s.id = t.service_id
left join public.bookings rb on rb.id = t.related_booking_id
left join public.profiles ps on ps.id = t.started_by
left join public.profiles pd on pd.id = t.done_by;

grant select on public.task_board to authenticated;
revoke all on public.task_board from anon;
