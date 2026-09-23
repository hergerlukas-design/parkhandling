-- =============================================================================
-- Geschäftslogik: Aufgaben-Automatik, Status-Flow, Ortsstatus, Historie
-- Trigger-Funktionen laufen als security definer, damit Folgeänderungen
-- (z. B. Ortsstatus) unabhängig von den RLS-Rechten des Auslösers konsistent bleiben.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ortsstatus
-- free/occupied aus der Belegung, blocked (nur Halle) wenn eine tiefere Ebene derselben
-- Spalte belegt ist: Einlagern geht nur von oben nach unten, der Platz ist also nur mit
-- Umsetzen nutzbar. reserved wird manuell gesetzt und bleibt erhalten, solange frei.
-- -----------------------------------------------------------------------------
create or replace function public.location_occupancy(p_location_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.bookings
  where current_location_id = p_location_id
    and status not in ('completed', 'cancelled')
$$;

create or replace function public.refresh_location_status(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loc public.locations;
  occupied integer;
  lower_occupied boolean := false;
  next_status text;
begin
  if p_location_id is null then
    return;
  end if;

  select * into loc from public.locations where id = p_location_id for update;
  if not found then
    return;
  end if;

  occupied := public.location_occupancy(loc.id);

  if loc.area = 'hall' then
    select exists (
      select 1
      from public.locations l
      where l.area = 'hall'
        and l.rack = loc.rack
        and l.rack_column = loc.rack_column
        and l.level < loc.level
        and public.location_occupancy(l.id) > 0
    ) into lower_occupied;
  end if;

  next_status := case
    when occupied >= loc.capacity then 'occupied'
    when lower_occupied then 'blocked'
    when loc.status = 'reserved' then 'reserved'
    else 'free'
  end;

  if next_status is distinct from loc.status then
    update public.locations set status = next_status where id = loc.id;
  end if;
end;
$$;

-- Aktualisiert einen Ort und – in der Halle – alle Ebenen derselben Spalte.
create or replace function public.refresh_location_and_column(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loc public.locations;
  other uuid;
begin
  if p_location_id is null then
    return;
  end if;
  select * into loc from public.locations where id = p_location_id;
  if not found then
    return;
  end if;
  if loc.area = 'hall' then
    for other in
      select id from public.locations
      where area = 'hall' and rack = loc.rack and rack_column = loc.rack_column
      order by level
    loop
      perform public.refresh_location_status(other);
    end loop;
  else
    perform public.refresh_location_status(loc.id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Bewegungen → aktueller Ort der Buchung
-- -----------------------------------------------------------------------------
create or replace function public.on_vehicle_movement_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.moved_by is null then
    new.moved_by := auth.uid();
  end if;
  if new.from_location_id is null then
    select current_location_id into new.from_location_id
    from public.bookings where id = new.booking_id;
  end if;
  return new;
end;
$$;

create trigger vehicle_movements_before_insert
  before insert on public.vehicle_movements
  for each row execute function public.on_vehicle_movement_insert();

create or replace function public.after_vehicle_movement_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nur übernehmen, wenn dies die jüngste Bewegung ist (nachträglich erfasste
  -- Bewegungen dürfen den aktuellen Ort nicht überschreiben).
  if not exists (
    select 1 from public.vehicle_movements
    where booking_id = new.booking_id
      and (moved_at > new.moved_at or (moved_at = new.moved_at and created_at > new.created_at))
  ) then
    update public.bookings
    set current_location_id = new.to_location_id
    where id = new.booking_id
      and current_location_id is distinct from new.to_location_id;
  end if;
  return null;
end;
$$;

create trigger vehicle_movements_after_insert
  after insert on public.vehicle_movements
  for each row execute function public.after_vehicle_movement_insert();

-- Ortsstatus nachziehen, wenn sich Ort oder Status einer Buchung ändert
create or replace function public.after_booking_location_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    perform public.refresh_location_and_column(old.current_location_id);
  end if;
  if tg_op = 'INSERT' or new.current_location_id is distinct from old.current_location_id then
    perform public.refresh_location_and_column(new.current_location_id);
  end if;
  return null;
end;
$$;

create trigger bookings_location_status
  after insert or update of current_location_id, status on public.bookings
  for each row execute function public.after_booking_location_change();

-- -----------------------------------------------------------------------------
-- Leistungen → Aufgaben
-- -----------------------------------------------------------------------------
create or replace function public.task_type_for_category(p_category text)
returns text
language sql
immutable
as $$
  select case p_category
    when 'charge' then 'charge'
    when 'fuel' then 'fuel'
    else 'service'
  end
$$;

-- Beim Anlegen einer Buchung: Standardleistungen (z. B. Grundreinigung) immer buchen.
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
  on conflict (booking_id, service_id) do nothing;
  return null;
end;
$$;

create trigger bookings_default_services
  after insert on public.bookings
  for each row execute function public.after_booking_insert_defaults();

-- Aufgabe zu einer gebuchten Leistung anlegen (falls keine aktive existiert)
create or replace function public.ensure_service_task(p_booking_service_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  lead_minutes integer;
begin
  select bs.id, bs.booking_id, bs.service_id, s.name, s.category, b.end_at, b.status as booking_status
  into rec
  from public.booking_services bs
  join public.services s on s.id = bs.service_id
  join public.bookings b on b.id = bs.booking_id
  where bs.id = p_booking_service_id and bs.status = 'active';

  if not found or rec.booking_status in ('completed', 'cancelled') then
    return;
  end if;

  if exists (
    select 1 from public.tasks
    where booking_service_id = rec.id and status <> 'cancelled'
  ) then
    return;
  end if;

  lead_minutes := coalesce((public.get_setting('task_due_before_pickup_minutes') #>> '{}')::integer, 120);

  insert into public.tasks (booking_id, type, service_id, booking_service_id, title, due_at)
  values (
    rec.booking_id,
    public.task_type_for_category(rec.category),
    rec.service_id,
    rec.id,
    rec.name,
    rec.end_at - make_interval(mins => lead_minutes)
  );
end;
$$;

create or replace function public.log_booking_change(p_booking_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.booking_history (booking_id, changed_fields, source, changed_by)
  values (
    p_booking_id,
    p_changes,
    coalesce(nullif(current_setting('app.change_source', true), ''), 'app'),
    auth.uid()
  );
end;
$$;

create or replace function public.after_booking_service_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  svc public.services;
begin
  select * into svc from public.services where id = new.service_id;

  if tg_op = 'INSERT' then
    if new.status = 'active' then
      perform public.ensure_service_task(new.id);
    end if;
    -- Nachgebuchte Leistungen protokollieren; Leistungen aus derselben Transaktion wie
    -- die Buchungsanlage (Standardleistungen, Erstbuchung) gehören zur Buchung selbst.
    if (select created_at from public.bookings where id = new.booking_id) < now() then
      perform public.log_booking_change(
        new.booking_id,
        jsonb_build_object('service_added', jsonb_build_object('code', svc.code, 'price', new.price_at_booking))
      );
    end if;
    return null;
  end if;

  -- UPDATE
  if new.status = 'cancelled' and old.status = 'active' then
    update public.tasks
    set status = 'cancelled'
    where booking_service_id = new.id and status in ('open', 'in_progress');
    perform public.log_booking_change(
      new.booking_id,
      jsonb_build_object('service_cancelled', jsonb_build_object('code', svc.code))
    );
  elsif new.status = 'active' and old.status = 'cancelled' then
    perform public.ensure_service_task(new.id);
    perform public.log_booking_change(
      new.booking_id,
      jsonb_build_object('service_added', jsonb_build_object('code', svc.code, 'price', new.price_at_booking))
    );
  end if;
  return null;
end;
$$;

create trigger booking_services_tasks
  after insert or update of status on public.booking_services
  for each row execute function public.after_booking_service_change();

create or replace function public.before_booking_service_update()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  elsif new.status = 'active' then
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

create trigger booking_services_cancelled_at
  before update of status on public.booking_services
  for each row execute function public.before_booking_service_update();

-- -----------------------------------------------------------------------------
-- Aufgaben → Buchungsstatus
-- Alle Leistungsaufgaben (ohne Umsetzen, ohne storniert) erledigt → ready.
-- Eine Aufgabe in Arbeit → in_service. Neue offene Aufgabe bei ready → zurück.
-- -----------------------------------------------------------------------------
create or replace function public.before_task_write()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.done_at := coalesce(new.done_at, now());
    new.done_by := coalesce(new.done_by, auth.uid());
  elsif new.status <> 'done' then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end;
$$;

create trigger tasks_done_fields
  before insert or update of status on public.tasks
  for each row execute function public.before_task_write();

create or replace function public.refresh_booking_readiness(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  open_count integer;
  active_count integer;
  in_progress_count integer;
  next_status text;
begin
  select bk.id, bk.status, l.area
  into b
  from public.bookings bk
  left join public.locations l on l.id = bk.current_location_id
  where bk.id = p_booking_id
  for update of bk;

  if not found or b.status not in ('arrived', 'stored', 'in_service', 'ready') then
    return;
  end if;

  select
    count(*) filter (where status in ('open', 'in_progress')),
    count(*) filter (where status <> 'cancelled'),
    count(*) filter (where status = 'in_progress')
  into open_count, active_count, in_progress_count
  from public.tasks
  where booking_id = p_booking_id and type <> 'relocate';

  next_status := case
    when open_count = 0 then 'ready'
    when in_progress_count > 0 then 'in_service'
    when b.status in ('ready', 'in_service') then
      case when b.area in ('hall', 'outdoor_a', 'outdoor_b') then 'stored' else 'arrived' end
    else b.status
  end;

  if next_status is distinct from b.status then
    update public.bookings set status = next_status where id = p_booking_id;
  end if;
end;
$$;

create or replace function public.after_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_booking_readiness(old.booking_id);
  else
    perform public.refresh_booking_readiness(new.booking_id);
  end if;
  return null;
end;
$$;

create trigger tasks_booking_readiness
  after insert or update of status or delete on public.tasks
  for each row execute function public.after_task_change();

-- -----------------------------------------------------------------------------
-- Buchungshistorie bei Änderungen an der Buchung
-- Quelle über `set local app.change_source = 'csv_import'` o. ä. setzbar.
-- -----------------------------------------------------------------------------
create or replace function public.after_booking_update_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changes jsonb := '{}'::jsonb;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  k text;
begin
  foreach k in array array[
    'external_ref', 'customer_name', 'customer_email', 'customer_phone', 'plate', 'vehicle_model',
    'persons', 'start_at', 'end_at', 'parking_type', 'return_mode', 'status', 'notes'
  ] loop
    if old_row -> k is distinct from new_row -> k then
      changes := changes || jsonb_build_object(k, jsonb_build_object('old', old_row -> k, 'new', new_row -> k));
    end if;
  end loop;

  if changes <> '{}'::jsonb then
    perform public.log_booking_change(new.id, changes);
  end if;

  -- Abholzeit geändert → Fälligkeit offener Leistungsaufgaben anpassen
  if new.end_at is distinct from old.end_at then
    update public.tasks
    set due_at = due_at + (new.end_at - old.end_at)
    where booking_id = new.id and status in ('open', 'in_progress') and type <> 'relocate' and due_at is not null;
  end if;

  -- Storno → offene Aufgaben stornieren
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.tasks set status = 'cancelled'
    where booking_id = new.id and status in ('open', 'in_progress');
  end if;
  return null;
end;
$$;

create trigger bookings_history
  after update on public.bookings
  for each row execute function public.after_booking_update_history();
