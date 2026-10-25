-- =============================================================================
-- 0.26.0 Hol- & Bringservice = Übergabe am Terminal (Entscheidung Lukas 25.10.2026)
--
-- Buchungen mit return_mode = 'pickup_delivery' bekommen zwei eigene Aufträge
-- (transport_jobs.type = 'pickup_delivery', je Fahrzeug ein Auftrag, kein Slot):
--   * Übernahme am Terminal (from_airport, Auto Terminal → Platz): zur Ankunftszeit start_at
--   * Rückgabe am Terminal  (to_airport,   Auto Platz → Terminal): Landung + valet_return_after_landing_minutes
--                                                                 ohne Landezeit: end_at − return_buffer_minutes + …
-- Umbuchung, Storno, Wechsel Shuttle ↔ Hol- & Bring und geänderte Einstellungen planen neu.
-- Rein additiv: Typ-Liste erweitert, Funktionen ersetzt.
-- =============================================================================

insert into public.settings (key, value, description) values
  ('valet_return_after_landing_minutes', '30',
   'Hol- & Bringservice: Auto steht so viele Minuten nach der Landung am Terminal bereit')
on conflict (key) do nothing;

alter table public.transport_jobs drop constraint if exists transport_jobs_type_check;
alter table public.transport_jobs
  add constraint transport_jobs_type_check check (type in ('shuttle_slot', 'premium_on_demand', 'pickup_delivery'));

-- Gewünschte Zeit je Rückgabeart und Richtung
create or replace function public.transport_wanted_at(b public.bookings, p_direction text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select date_trunc('minute', case
    -- Hol- & Bringservice: Übernahme am Terminal zur Ankunftszeit
    when b.return_mode = 'pickup_delivery' and p_direction = 'from_airport' then
      b.start_at
    -- Hol- & Bringservice: Rückgabe am Terminal nach der Landung
    when b.return_mode = 'pickup_delivery' then
      coalesce(b.return_flight_at,
               b.end_at - make_interval(mins => coalesce((public.get_setting('return_buffer_minutes', '60') #>> '{}')::integer, 60)))
      + make_interval(mins => coalesce((public.get_setting('valet_return_after_landing_minutes', '30') #>> '{}')::integer, 30))
    -- Shuttle hin: Ankunft am Platz + Annahme
    when p_direction = 'to_airport' then
      b.start_at + make_interval(mins => coalesce((public.get_setting('shuttle_checkin_minutes', '15') #>> '{}')::integer, 15))
    -- Shuttle zurück: Landung + Gepäck
    else
      coalesce(b.return_flight_at,
               b.end_at - make_interval(mins => coalesce((public.get_setting('return_buffer_minutes', '60') #>> '{}')::integer, 60)))
      + make_interval(mins => coalesce((public.get_setting('shuttle_pickup_after_landing_minutes', '30') #>> '{}')::integer, 30))
  end)
$$;

revoke execute on function public.transport_wanted_at(public.bookings, text) from public, anon;

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

    v_want := b.return_mode in ('shuttle', 'pickup_delivery') and b.status not in ('cancelled', 'completed');

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

    if b.return_mode = 'pickup_delivery' then
      v_type := 'pickup_delivery';
    elsif b.parking_type = 'indoor' then
      v_type := 'premium_on_demand';
    else
      v_type := null; -- Slot, sonst auf Abruf
    end if;

    -- Von der Dispo umgesetzt: nur Personenzahl nachziehen, solange die Rückgabeart passt
    if cur.job_id is not null and cur.manual
       and (cur.type = 'pickup_delivery') = (b.return_mode = 'pickup_delivery') then
      update public.transport_passengers set persons = b.persons
      where id = cur.passenger_id and persons is distinct from b.persons;
      continue;
    end if;

    v_at := public.transport_wanted_at(b, v_dir);
    if v_type is null then
      v_slot := public.shuttle_slot_at(v_at);
      v_type := case when v_slot is null then 'premium_on_demand' else 'shuttle_slot' end;
    end if;

    if v_type = 'shuttle_slot' then
      insert into public.transport_jobs (type, direction, scheduled_at)
      values ('shuttle_slot', v_dir, v_slot)
      on conflict (direction, scheduled_at) where type = 'shuttle_slot' do nothing;
      select id into v_target from public.transport_jobs
      where type = 'shuttle_slot' and direction = v_dir and scheduled_at = v_slot;
    elsif cur.job_id is not null and cur.type = v_type and cur.passenger_count = 1 then
      -- eigener Auftrag (auf Abruf bzw. Hol- & Bring): Uhrzeit nachziehen
      v_target := cur.job_id;
      update public.transport_jobs set scheduled_at = v_at
      where id = v_target and scheduled_at is distinct from v_at;
    else
      insert into public.transport_jobs (type, direction, scheduled_at)
      values (v_type, v_dir, v_at)
      returning id into v_target;
    end if;

    if cur.job_id = v_target then
      update public.transport_passengers set persons = b.persons, manual = false
      where id = cur.passenger_id and (persons is distinct from b.persons or manual);
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
      and (b.return_mode in ('shuttle', 'pickup_delivery')
           or exists (select 1 from public.transport_passengers p where p.booking_id = b.id))
  loop
    perform public.plan_booking_transport(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.after_shuttle_setting_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key in ('shuttle_hours', 'shuttle_interval_minutes', 'shuttle_checkin_minutes',
                 'shuttle_pickup_after_landing_minutes', 'return_buffer_minutes',
                 'valet_return_after_landing_minutes')
     and new.value is distinct from old.value then
    perform public.plan_booking_transport(b.id)
    from public.bookings b
    where b.end_at > now() - interval '1 day'
      and (b.return_mode in ('shuttle', 'pickup_delivery')
           or exists (select 1 from public.transport_passengers p where p.booking_id = b.id));
  end if;
  return null;
end;
$$;

-- Umsetzen: Hol- & Bring-Aufträge behalten ihren Typ (nur Uhrzeit ändern),
-- Shuttle-Fahrgäste nur zwischen Shuttle-Fahrten
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
    if (dst.type = 'pickup_delivery') <> (src.type = 'pickup_delivery') then
      raise exception 'Hol- & Bringservice und Shuttle lassen sich nicht mischen' using errcode = '22023';
    end if;
    if dst.status in ('underway', 'done', 'cancelled') then
      raise exception 'Fahrt ist nicht mehr offen' using errcode = '22023';
    end if;
  elsif p_at is not null then
    if src.type = 'pickup_delivery' then
      -- eigener Auftrag: nur Uhrzeit ändern
      update public.transport_jobs set scheduled_at = date_trunc('minute', p_at) where id = src.id;
      update public.transport_passengers set manual = true where id = p.id;
      return src.id;
    end if;
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

revoke execute on function public.move_transport_passenger(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.move_transport_passenger(uuid, uuid, timestamptz) to authenticated;

-- Bestand einplanen (Hol- & Bring neu, Shuttle unverändert)
select public.plan_booking_transport(b.id)
from public.bookings b
where b.return_mode = 'pickup_delivery' and b.status not in ('cancelled', 'completed');

-- =============================================================================
-- Terminal aus der Flugnummer und Rückweg des Fahrers (Antworten Lukas 25.10.2026)
--   * Treffpunkt = Terminal, an dem der Gast ankommt; ermittelt aus dem Airline-Code
--     der Flugnummer über settings.airport_terminal_map (ohne Treffer: default)
--   * Fahrer fährt mit dem Shuttle: zur Übernahme mit dem letzten Shuttle zum Flughafen,
--     der vor der Übergabe ankommt; nach der Rückgabe mit dem nächsten Shuttle zurück
-- =============================================================================

insert into public.settings (key, value, description) values
  ('shuttle_transfer_minutes', '16',
   'Fahrzeit Shuttle Parkplatz ↔ Terminal in Minuten (laut Parkos)'),
  ('valet_handover_minutes', '15',
   'Hol- & Bringservice: Dauer der Übergabe am Terminal, bevor der Fahrer den Shuttle zurück nimmt'),
  ('airport_terminal_map', '{
     "default": "T1",
     "T2": ["LH", "CL", "EN", "LX", "OS", "SN", "A3", "OA", "TP", "LO", "OU", "LG", "KM", "NZ", "CA", "TG", "BR", "SA", "MS", "AD", "AV", "S4", "UA", "AC", "NH", "SQ", "ET", "AI"]
   }',
   'Terminal je Airline-Code (IATA, 2 Zeichen) am Flughafen München; nicht gelistete Codes → default. Lufthansa-Gruppe und Star Alliance = T2')
on conflict (key) do nothing;

-- Airline-Code aus der Flugnummer („LH2066“ → LH, „4U 123“ → 4U)
create or replace function public.flight_airline(p_flight text)
returns text
language sql
immutable
set search_path = public
as $$
  select substring(upper(regexp_replace(coalesce(p_flight, ''), '\s', '', 'g')) from '^([A-Z0-9]{2})[0-9]')
$$;

-- Terminal zur Flugnummer (null ohne Flugnummer)
create or replace function public.terminal_for_flight(p_flight text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.flight_airline(p_flight) is null then null
    else coalesce(
      (select t.key
       from jsonb_each(public.get_setting('airport_terminal_map', '{"default": "T1"}') - 'default') t
       where jsonb_typeof(t.value) = 'array' and t.value ? public.flight_airline(p_flight)
       limit 1),
      public.get_setting('airport_terminal_map', '{"default": "T1"}') ->> 'default')
  end
$$;

revoke execute on function public.terminal_for_flight(text) from public, anon;
grant execute on function public.terminal_for_flight(text) to authenticated, service_role;

-- Letzter Slot, der höchstens p_at ist (innerhalb der Betriebszeiten), sonst null
create or replace function public.shuttle_slot_before(p_at timestamptz)
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
  if p_at is null or v_local < v_start then
    return null;
  end if;
  v_slot := v_start + floor(extract(epoch from (least(v_local, v_end) - v_start)) / (v_step * 60))::integer * make_interval(mins => v_step);
  return v_slot at time zone 'Europe/Berlin';
end;
$$;

revoke execute on function public.shuttle_slot_before(timestamptz) from public, anon;

-- Shuttle des Fahrers zu einem Hol- & Bring-Auftrag
--   Übernahme (from_airport): Shuttle zum Flughafen, der spätestens zur Übergabe am Terminal ist
--   Rückgabe  (to_airport):   nächster Shuttle vom Flughafen nach der Übergabe
create or replace function public.valet_driver_shuttle_at(p_direction text, p_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case p_direction
    when 'from_airport' then public.shuttle_slot_before(
      p_at - make_interval(mins => coalesce((public.get_setting('shuttle_transfer_minutes', '16') #>> '{}')::integer, 16)))
    else public.shuttle_slot_at(
      p_at + make_interval(mins => coalesce((public.get_setting('valet_handover_minutes', '15') #>> '{}')::integer, 15)))
  end
$$;

revoke execute on function public.valet_driver_shuttle_at(text, timestamptz) from public, anon;

-- Dispo-Ansicht: Flug je Fahrt passend zur Art, Terminal je Fahrgast, Shuttle des Fahrers
drop function if exists public.transport_board(timestamptz, timestamptz);
create function public.transport_board(p_from timestamptz, p_to timestamptz)
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
  passengers jsonb,
  driver_shuttle_at timestamptz
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
           'flight', x.flight,
           'terminal', public.terminal_for_flight(x.flight),
           'start_at', b.start_at,
           'return_flight_at', b.return_flight_at,
           'end_at', b.end_at,
           'parking_type', b.parking_type,
           'booking_status', b.status
         ) order by b.plate) filter (where p.id is not null), '[]'::jsonb),
         case when j.type = 'pickup_delivery' then public.valet_driver_shuttle_at(j.direction, j.scheduled_at) end
  from public.transport_jobs j
  left join public.profiles d on d.id = j.driver_id
  left join public.transport_passengers p on p.transport_job_id = j.id
  left join public.bookings b on b.id = p.booking_id
  -- Hinweg-Flug: Shuttle zum Flughafen bzw. Hol- & Bring-Übernahme; sonst Rückflug
  left join lateral (
    select case when (j.direction = 'to_airport') <> (j.type = 'pickup_delivery') then b.flight_out else b.flight_return end as flight
  ) x on true
  where public.is_staff()
    and j.scheduled_at >= p_from and j.scheduled_at < p_to
  group by j.id, d.display_name
  order by j.scheduled_at, j.direction
$$;

revoke execute on function public.transport_board(timestamptz, timestamptz) from public, anon;
grant execute on function public.transport_board(timestamptz, timestamptz) to authenticated;
