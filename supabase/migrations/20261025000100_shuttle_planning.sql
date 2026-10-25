-- =============================================================================
-- 0.24.0 Shuttle-Dispo (Schritt 9, Teil Shuttle)
--
-- Jede aktive Buchung mit return_mode = 'shuttle' bekommt automatisch zwei Fahrten:
--   * Hinfahrt  (to_airport):   Ankunft am Platz + shuttle_checkin_minutes
--   * Rückfahrt (from_airport): Landung (return_flight_at) + shuttle_pickup_after_landing_minutes
--                               ohne Landezeit: end_at − return_buffer_minutes
-- Standardkunden landen im nächsten Slot (Takt shuttle_interval_minutes innerhalb
-- shuttle_hours). Halle (Premium) und Zeiten außerhalb der Betriebszeiten werden
-- einzelne Aufträge „auf Abruf“ (premium_on_demand) zur genauen Uhrzeit.
--
-- Umbuchung, Storno, Personenzahl oder geänderte Einstellungen planen automatisch neu.
-- Von Hand umgesetzte Fahrgäste (manual) und Fahrten, die schon laufen oder erledigt
-- sind, werden nicht mehr verschoben. Leere, unbesetzte Fahrten werden aufgeräumt.
-- Kapazität wird nur angezeigt (Warnung), nicht automatisch umverteilt.
--
-- Rein additiv: alte App-Versionen arbeiten unverändert weiter (Abschnitt 6, Punkt 7).
-- =============================================================================

-- 1) Einstellungen ------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('shuttle_checkin_minutes', '15',
   'Shuttle Hinfahrt frühestens so viele Minuten nach Ankunft am Platz (Annahme, Protokoll)'),
  ('shuttle_pickup_after_landing_minutes', '30',
   'Shuttle Rückfahrt: Abholung am Terminal so viele Minuten nach der Landung (Gepäck)')
on conflict (key) do nothing;

-- 2) Spalten -------------------------------------------------------------------
alter table public.transport_passengers
  add column if not exists manual boolean not null default false;

comment on column public.transport_passengers.manual is
  'true = von der Dispo umgesetzt; die automatische Planung verschiebt diesen Fahrgast nicht mehr';

-- Realtime läuft nur auf transport_jobs: Fahrgast-Änderungen „berühren“ ihre Fahrt,
-- damit offene Geräte neu laden.
create or replace function public.touch_transport_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.transport_jobs set updated_at = now()
  where id in (
    case when tg_op <> 'INSERT' then old.transport_job_id end,
    case when tg_op <> 'DELETE' then new.transport_job_id end
  );
  return null;
end;
$$;

drop trigger if exists transport_passengers_touch_job on public.transport_passengers;
create trigger transport_passengers_touch_job
  after insert or update or delete on public.transport_passengers
  for each row execute function public.touch_transport_job();

-- 3) Slot-Berechnung ------------------------------------------------------------
-- Nächster Slot ab p_at (inklusive) im Takt innerhalb der Betriebszeiten, sonst null.
create or replace function public.shuttle_slot_at(p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hours jsonb := public.get_setting('shuttle_hours', '{"start": "05:00", "end": "23:00"}');
  v_step integer := greatest(coalesce((public.get_setting('shuttle_interval_minutes', '60') #>> '{}')::integer, 60), 5);
  v_local timestamp := p_at at time zone 'Europe/Berlin';
  v_day timestamp := date_trunc('day', v_local);
  v_start timestamp := v_day + coalesce(v_hours ->> 'start', '05:00')::interval;
  v_end timestamp := v_day + coalesce(v_hours ->> 'end', '23:00')::interval;
  v_slot timestamp;
begin
  if p_at is null or v_local < v_start or v_local > v_end then
    return null;
  end if;
  v_slot := v_start + ceil(extract(epoch from (v_local - v_start)) / (v_step * 60))::integer * make_interval(mins => v_step);
  if v_slot > v_end then
    return null;
  end if;
  return v_slot at time zone 'Europe/Berlin';
end;
$$;

-- Gewünschte Fahrzeit einer Buchung je Richtung (vor Slot-Rundung)
create or replace function public.transport_wanted_at(b public.bookings, p_direction text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select date_trunc('minute', case p_direction
    when 'to_airport' then
      b.start_at + make_interval(mins => coalesce((public.get_setting('shuttle_checkin_minutes', '15') #>> '{}')::integer, 15))
    else
      coalesce(b.return_flight_at,
               b.end_at - make_interval(mins => coalesce((public.get_setting('return_buffer_minutes', '60') #>> '{}')::integer, 60)))
      + make_interval(mins => coalesce((public.get_setting('shuttle_pickup_after_landing_minutes', '30') #>> '{}')::integer, 30))
  end)
$$;

-- Leere, noch nicht begonnene Fahrt ohne Fahrer entfernen
create or replace function public.cleanup_transport_job(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.transport_jobs j
  where j.id = p_job_id
    and j.status = 'planned'
    and j.driver_id is null
    and not exists (select 1 from public.transport_passengers p where p.transport_job_id = j.id)
$$;

-- 4) Planung einer Buchung -------------------------------------------------------
create or replace function public.plan_booking_transport(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_dir text;
  v_want boolean;
  v_at timestamptz;
  v_slot timestamptz;
  v_type text;
  v_target uuid;
  cur record;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null then
    return;
  end if;

  foreach v_dir in array array['to_airport', 'from_airport'] loop
    select p.id as passenger_id, p.manual, p.persons, j.id as job_id, j.type, j.status,
           (select count(*) from public.transport_passengers x where x.transport_job_id = j.id) as passenger_count
    into cur
    from public.transport_passengers p
    join public.transport_jobs j on j.id = p.transport_job_id
    where p.booking_id = b.id and j.direction = v_dir
    order by j.status in ('underway', 'done') desc, j.scheduled_at
    limit 1;

    v_want := b.return_mode = 'shuttle' and b.status not in ('cancelled', 'completed');

    -- Laufende/erledigte Fahrten nicht mehr anfassen
    if cur.job_id is not null and cur.status in ('underway', 'done') then
      continue;
    end if;

    if not v_want then
      if cur.job_id is not null then
        delete from public.transport_passengers where id = cur.passenger_id;
        perform public.cleanup_transport_job(cur.job_id);
      end if;
      continue;
    end if;

    -- Von der Dispo umgesetzt: nur Personenzahl nachziehen
    if cur.job_id is not null and cur.manual then
      update public.transport_passengers set persons = b.persons
      where id = cur.passenger_id and persons is distinct from b.persons;
      continue;
    end if;

    v_at := public.transport_wanted_at(b, v_dir);
    v_slot := case when b.parking_type = 'indoor' then null else public.shuttle_slot_at(v_at) end;
    v_type := case when v_slot is null then 'premium_on_demand' else 'shuttle_slot' end;

    if v_type = 'shuttle_slot' then
      insert into public.transport_jobs (type, direction, scheduled_at)
      values ('shuttle_slot', v_dir, v_slot)
      on conflict (direction, scheduled_at) where type = 'shuttle_slot' do nothing;
      select id into v_target from public.transport_jobs
      where type = 'shuttle_slot' and direction = v_dir and scheduled_at = v_slot;
    elsif cur.job_id is not null and cur.type = 'premium_on_demand' and cur.passenger_count = 1 then
      -- eigener Auftrag auf Abruf: Uhrzeit nachziehen
      v_target := cur.job_id;
      update public.transport_jobs set scheduled_at = v_at
      where id = v_target and scheduled_at is distinct from v_at;
    else
      insert into public.transport_jobs (type, direction, scheduled_at)
      values ('premium_on_demand', v_dir, v_at)
      returning id into v_target;
    end if;

    if cur.job_id = v_target then
      update public.transport_passengers set persons = b.persons
      where id = cur.passenger_id and persons is distinct from b.persons;
    else
      if cur.job_id is not null then
        delete from public.transport_passengers where id = cur.passenger_id;
        perform public.cleanup_transport_job(cur.job_id);
      end if;
      insert into public.transport_passengers (transport_job_id, booking_id, persons)
      values (v_target, b.id, b.persons)
      on conflict (transport_job_id, booking_id) do update set persons = excluded.persons;
    end if;
  end loop;
end;
$$;

revoke execute on function public.plan_booking_transport(uuid) from public, anon;
grant execute on function public.plan_booking_transport(uuid) to authenticated, service_role;
revoke execute on function public.shuttle_slot_at(timestamptz) from public, anon;
grant execute on function public.shuttle_slot_at(timestamptz) to authenticated, service_role;
revoke execute on function public.transport_wanted_at(public.bookings, text) from public, anon;
revoke execute on function public.cleanup_transport_job(uuid) from public, anon, authenticated;

-- Alle künftigen Fahrten neu planen (z. B. nach geänderten Einstellungen)
create or replace function public.replan_transport()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if not public.can_write_bookings() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  for v_id in
    select b.id from public.bookings b
    where b.end_at > now() - interval '1 day'
      and (b.return_mode = 'shuttle'
           or exists (select 1 from public.transport_passengers p where p.booking_id = b.id))
  loop
    perform public.plan_booking_transport(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.replan_transport() from public, anon;
grant execute on function public.replan_transport() to authenticated, service_role;

-- 5) Trigger -------------------------------------------------------------------
create or replace function public.after_booking_transport_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.plan_booking_transport(new.id);
  return null;
end;
$$;

drop trigger if exists bookings_transport_plan on public.bookings;
create trigger bookings_transport_plan
  after insert or update of start_at, end_at, return_flight_at, return_mode, parking_type, persons, status
  on public.bookings
  for each row execute function public.after_booking_transport_change();

create or replace function public.after_shuttle_setting_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key in ('shuttle_hours', 'shuttle_interval_minutes', 'shuttle_checkin_minutes',
                 'shuttle_pickup_after_landing_minutes', 'return_buffer_minutes')
     and new.value is distinct from old.value then
    perform public.plan_booking_transport(b.id)
    from public.bookings b
    where b.end_at > now() - interval '1 day'
      and (b.return_mode = 'shuttle'
           or exists (select 1 from public.transport_passengers p where p.booking_id = b.id));
  end if;
  return null;
end;
$$;

drop trigger if exists settings_shuttle_replan on public.settings;
create trigger settings_shuttle_replan
  after update on public.settings
  for each row execute function public.after_shuttle_setting_change();

-- 6) Dispo-Aktionen --------------------------------------------------------------
-- Fahrgast in eine andere Fahrt derselben Richtung umsetzen (p_job_id) oder in einen
-- neuen Auftrag auf Abruf zur Uhrzeit p_at. Danach plant die Automatik ihn nicht mehr um.
create or replace function public.move_transport_passenger(p_passenger_id uuid, p_job_id uuid default null, p_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.transport_passengers;
  src public.transport_jobs;
  dst public.transport_jobs;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  select * into p from public.transport_passengers where id = p_passenger_id for update;
  if p.id is null then
    raise exception 'Fahrgast nicht gefunden' using errcode = 'P0002';
  end if;
  select * into src from public.transport_jobs where id = p.transport_job_id;
  if src.status in ('underway', 'done') then
    raise exception 'Die Fahrt ist schon unterwegs oder erledigt' using errcode = '22023';
  end if;

  if p_job_id is not null then
    select * into dst from public.transport_jobs where id = p_job_id;
    if dst.id is null then
      raise exception 'Fahrt nicht gefunden' using errcode = 'P0002';
    end if;
    if dst.direction <> src.direction then
      raise exception 'Fahrt hat eine andere Richtung' using errcode = '22023';
    end if;
    if dst.status in ('underway', 'done', 'cancelled') then
      raise exception 'Fahrt ist nicht mehr offen' using errcode = '22023';
    end if;
  elsif p_at is not null then
    insert into public.transport_jobs (type, direction, scheduled_at)
    values ('premium_on_demand', src.direction, date_trunc('minute', p_at))
    returning * into dst;
  else
    raise exception 'Ziel fehlt' using errcode = '22023';
  end if;

  if dst.id = src.id then
    update public.transport_passengers set manual = true where id = p.id;
    return dst.id;
  end if;

  delete from public.transport_passengers where id = p.id;
  insert into public.transport_passengers (transport_job_id, booking_id, persons, manual)
  values (dst.id, p.booking_id, p.persons, true)
  on conflict (transport_job_id, booking_id) do update set manual = true;
  perform public.cleanup_transport_job(src.id);
  return dst.id;
end;
$$;

-- Umsetzung zurücknehmen: Automatik plant den Fahrgast wieder ein
create or replace function public.reset_transport_passenger(p_passenger_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking uuid;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  update public.transport_passengers set manual = false where id = p_passenger_id
  returning booking_id into v_booking;
  if v_booking is not null then
    perform public.plan_booking_transport(v_booking);
  end if;
end;
$$;

revoke execute on function public.move_transport_passenger(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.move_transport_passenger(uuid, uuid, timestamptz) to authenticated;
revoke execute on function public.reset_transport_passenger(uuid) from public, anon;
grant execute on function public.reset_transport_passenger(uuid) to authenticated;

-- Fahrerauswahl: aktive Personen (profiles ist für staff per RLS nicht lesbar)
create or replace function public.list_drivers()
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name from public.profiles p
  where p.active and public.is_staff()
  order by p.display_name
$$;

revoke execute on function public.list_drivers() from public, anon;
grant execute on function public.list_drivers() to authenticated;

-- 7) Dispo-Ansicht ---------------------------------------------------------------
-- Fahrten im Zeitraum [p_from, p_to) mit Fahrgästen, Personen, Kapazität und Fahrer.
create or replace function public.transport_board(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  type text,
  direction text,
  scheduled_at timestamptz,
  status text,
  driver_id uuid,
  driver_name text,
  meeting_point text,
  note text,
  persons integer,
  capacity integer,
  passengers jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.type, j.direction, j.scheduled_at, j.status, j.driver_id, d.display_name,
         j.meeting_point, j.note,
         coalesce(sum(p.persons) filter (where b.status <> 'cancelled'), 0)::integer,
         coalesce((public.get_setting('shuttle_capacity', '8') #>> '{}')::integer, 8),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'booking_id', b.id,
           'persons', p.persons,
           'manual', p.manual,
           'plate', b.plate,
           'vehicle_model', b.vehicle_model,
           'customer_name', b.customer_name,
           'customer_phone', b.customer_phone,
           'customer_language', b.customer_language,
           'flight', case when j.direction = 'to_airport' then b.flight_out else b.flight_return end,
           'start_at', b.start_at,
           'return_flight_at', b.return_flight_at,
           'end_at', b.end_at,
           'parking_type', b.parking_type,
           'booking_status', b.status
         ) order by b.plate) filter (where p.id is not null), '[]'::jsonb)
  from public.transport_jobs j
  left join public.profiles d on d.id = j.driver_id
  left join public.transport_passengers p on p.transport_job_id = j.id
  left join public.bookings b on b.id = p.booking_id
  where public.is_staff()
    and j.scheduled_at >= p_from and j.scheduled_at < p_to
  group by j.id, d.display_name
  order by j.scheduled_at, j.direction
$$;

revoke execute on function public.transport_board(timestamptz, timestamptz) from public, anon;
grant execute on function public.transport_board(timestamptz, timestamptz) to authenticated;

-- Fahrten einer Buchung (Fahrzeug-Detail)
create or replace function public.booking_transport(p_booking_id uuid)
returns table (
  passenger_id uuid,
  job_id uuid,
  type text,
  direction text,
  scheduled_at timestamptz,
  status text,
  persons integer,
  manual boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, j.id, j.type, j.direction, j.scheduled_at, j.status, p.persons::integer, p.manual
  from public.transport_passengers p
  join public.transport_jobs j on j.id = p.transport_job_id
  where p.booking_id = p_booking_id and public.is_staff()
  order by j.scheduled_at
$$;

revoke execute on function public.booking_transport(uuid) from public, anon;
grant execute on function public.booking_transport(uuid) to authenticated;

-- 8) Bestand einplanen -------------------------------------------------------------
select public.plan_booking_transport(b.id)
from public.bookings b
where b.return_mode = 'shuttle' and b.status not in ('cancelled', 'completed');
