-- =============================================================================
-- Regal-Logik Halle (Arbeitsanweisung Abschnitt 5) und Ein-/Auschecken (Abschnitt 8)
--
-- Regeln je Spalte (E1 unten, E3 oben):
--   * Auslagern nur von unten nach oben: ein Fahrzeug kommt nur raus, wenn alle Ebenen darunter leer sind.
--   * Einlagern nur von oben nach unten: ein Platz ist nur erreichbar, wenn alle Ebenen darunter leer sind.
--   * Sollreihenfolge: end_at(E1) ≤ end_at(E2) ≤ end_at(E3).
-- Konflikt = ein Fahrzeug unten wird später abgeholt als eines darüber. Je Blockierer kostet das
-- zwei Umsetzvorgänge (raus und wieder rein).
-- Additiv und abwärtskompatibel zu 0.5.0.
-- =============================================================================

alter table public.tasks
  add column if not exists related_booking_id uuid references public.bookings (id) on delete cascade;

comment on column public.tasks.related_booking_id is
  'Nur Umsetz-Aufgaben: die Buchung, deren Abholung durch dieses Fahrzeug blockiert wird.';

create index if not exists tasks_related_booking_idx on public.tasks (related_booking_id)
  where related_booking_id is not null;
create unique index if not exists tasks_open_relocate_uidx on public.tasks (booking_id, related_booking_id)
  where type = 'relocate' and status in ('open', 'in_progress');

-- -----------------------------------------------------------------------------
-- Belegung je Ort (Lageplan): ein Eintrag je Ort, bei Kapazität > 1 die zuletzt eingelagerte Buchung
-- -----------------------------------------------------------------------------
create or replace view public.location_board
with (security_invoker = true)
as
select
  l.id, l.code, l.name, l.area, l.rack, l.rack_column, l.level, l."row", l.number, l.has_cover,
  l.capacity, l.status, l.qr_code, l.active, l.sort_order,
  occ.cnt as occupancy,
  b.id as booking_id, b.plate, b.vehicle_model, b.end_at, b.status as booking_status,
  b.return_mode, b.fuel_type,
  coalesce(t.open_count, 0) as open_task_count
from public.locations l
left join lateral (
  select count(*)::int as cnt from public.bookings x
  where x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
) occ on true
left join lateral (
  select x.* from public.bookings x
  where x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
  order by x.updated_at desc
  limit 1
) b on true
left join lateral (
  select count(*) filter (where tk.status in ('open', 'in_progress') and tk.type <> 'relocate') as open_count
  from public.tasks tk where tk.booking_id = b.id
) t on true
where l.active;

grant select on public.location_board to authenticated;
revoke all on public.location_board from anon;

-- -----------------------------------------------------------------------------
-- Spalte prüfen: alle Konfliktpaare (Blockierer unten, blockiertes Fahrzeug darüber)
-- -----------------------------------------------------------------------------
create or replace function public.check_column(p_rack integer, p_column integer)
returns table (
  blocked_booking_id uuid,
  blocked_plate text,
  blocked_level smallint,
  blocked_end_at timestamptz,
  blocker_booking_id uuid,
  blocker_plate text,
  blocker_level smallint,
  blocker_end_at timestamptz,
  moves integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with slots as (
    select l.level, b.id, b.plate, b.end_at
    from public.locations l
    join public.bookings b on b.current_location_id = l.id and b.status not in ('completed', 'cancelled')
    where l.area = 'hall' and l.rack = p_rack and l.rack_column = p_column
  )
  select up.id, up.plate, up.level, up.end_at,
         lo.id, lo.plate, lo.level, lo.end_at,
         2 * (select count(*)::int from slots s where s.level < up.level and s.end_at > up.end_at)
  from slots up
  join slots lo on lo.level < up.level and lo.end_at > up.end_at
  order by up.end_at, lo.level
$$;

-- -----------------------------------------------------------------------------
-- Platzvorschlag Halle
--   kind = 'fits'      direkt erreichbar, Reihenfolge passt (sortiert nach score)
--          'conflict'  direkt erreichbar, aber ein Fahrzeug darüber wird früher abgeholt
--          'relocate'  frei, aber nur mit Umsetzen erreichbar (Ebenen darunter belegt)
--          'buffer'    Pufferplatz, falls kein passender Hallenplatz frei ist
-- -----------------------------------------------------------------------------
create or replace function public.suggest_hall_location(p_booking_id uuid)
returns table (
  location_id uuid,
  code text,
  kind text,
  reason text,
  moves integer,
  score numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_end timestamptz;
begin
  select end_at into v_end from public.bookings where id = p_booking_id;
  if v_end is null then
    raise exception 'Buchung % nicht gefunden', p_booking_id using errcode = 'P0002';
  end if;

  return query
  with hall as (
    select l.id, l.code, l.rack, l.rack_column, l.level, l.status,
           b.id as booking_id, b.plate, b.end_at
    from public.locations l
    left join public.bookings b
      on b.current_location_id = l.id and b.status not in ('completed', 'cancelled') and b.id <> p_booking_id
    where l.area = 'hall' and l.active
  ),
  candidates as (
    select h.*,
      (select count(*)::int from hall x where x.rack = h.rack and x.rack_column = h.rack_column
         and x.level < h.level and x.booking_id is not null) as below_occupied,
      (select count(*)::int from hall x where x.rack = h.rack and x.rack_column = h.rack_column
         and x.booking_id is not null) as column_occupied,
      (select min(x.end_at) from hall x where x.rack = h.rack and x.rack_column = h.rack_column
         and x.level > h.level and x.booking_id is not null) as above_min_end,
      (select x.plate || ' (' || to_char(x.end_at at time zone 'Europe/Berlin', 'DD.MM.') || ')'
         from hall x where x.rack = h.rack and x.rack_column = h.rack_column and x.level > h.level
           and x.booking_id is not null and x.end_at < v_end order by x.end_at limit 1) as above_conflict
    from hall h
    where h.booking_id is null and h.status <> 'reserved'
  )
  select c.id, c.code,
    case
      when c.below_occupied > 0 then 'relocate'
      when c.above_conflict is not null then 'conflict'
      else 'fits'
    end,
    case
      when c.below_occupied > 0 then
        format('Darunter stehen %s Fahrzeug(e). Einlagern kostet %s Bewegungen.', c.below_occupied, 2 * c.below_occupied)
      when c.above_conflict is not null then
        format('Darüber steht %s mit früherer Abholung. Dieses Fahrzeug würde es blockieren.', c.above_conflict)
      when c.column_occupied = 0 then
        'Leere Spalte. Ebenen darunter bleiben für frühere Abholungen frei.'
      else
        format('Reihenfolge passt: darüber wird erst am %s abgeholt.', to_char(c.above_min_end at time zone 'Europe/Berlin', 'DD.MM.'))
    end,
    case when c.below_occupied > 0 then 2 * c.below_occupied else 0 end,
    case
      when c.below_occupied > 0 then 100000 + c.below_occupied * 1000
      when c.above_conflict is not null then 50000
      -- teilbelegte Spalte: je enger die Reihenfolge, desto besser
      -- (bei gleichem Abstand höhere Ebene bevorzugen, damit unten Platz für frühere Abholungen bleibt)
      when c.column_occupied > 0 then round(extract(epoch from (c.above_min_end - v_end)) / 3600, 1) + (3 - c.level) * 0.1
      -- leere Spalte: oberste Ebene zuerst; spätere Abholungen bevorzugen leere Spalten
      else 5000 - round(extract(epoch from (v_end - now())) / 3600, 1) + (3 - c.level) * 100
    end
  from candidates c
  order by 6, c.code;

  -- Pufferplatz immer als Ausweichmöglichkeit anbieten
  return query
  select l.id, l.code, 'buffer'::text, 'Pufferzone: kurzfristig abstellen und später einlagern.'::text, 0, 200000::numeric
  from public.locations l
  where l.area = 'buffer' and l.active and l.status = 'free'
  order by l.sort_order
  limit 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Umsetz-Aufgaben für eine Spalte abgleichen: je Konfliktpaar genau eine offene Aufgabe,
-- aufgelöste Konflikte schließen ihre Aufgabe automatisch.
-- -----------------------------------------------------------------------------
create or replace function public.refresh_relocate_tasks(p_rack integer, p_column integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  lead_minutes integer := coalesce((public.get_setting('relocate_lead_minutes') #>> '{}')::integer, 60);
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  for c in select * from public.check_column(p_rack, p_column) loop
    insert into public.tasks (booking_id, related_booking_id, type, title, due_at, note)
    values (
      c.blocker_booking_id,
      c.blocked_booking_id,
      'relocate',
      format('Umsetzen: %s (E%s) blockiert %s (E%s)', c.blocker_plate, c.blocker_level, c.blocked_plate, c.blocked_level),
      c.blocked_end_at - make_interval(mins => lead_minutes),
      format('%s Umsetzvorgänge nötig, bevor %s abgeholt wird.', c.moves, c.blocked_plate)
    )
    on conflict (booking_id, related_booking_id) where type = 'relocate' and status in ('open', 'in_progress')
    do update set due_at = excluded.due_at, title = excluded.title, note = excluded.note
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Offene Umsetz-Aufgaben dieser Spalte, deren Konflikt nicht mehr besteht → erledigt
  update public.tasks t
  set status = 'done', note = coalesce(t.note || ' · ', '') || 'Konflikt aufgelöst'
  from public.bookings b
  join public.locations l on l.id = b.current_location_id
  where t.booking_id = b.id
    and t.type = 'relocate'
    and t.status in ('open', 'in_progress')
    and not (t.id = any (v_ids))
    and l.area = 'hall' and l.rack = p_rack and l.rack_column = p_column;
end;
$$;

-- Umsetz-Aufgaben von Fahrzeugen, die die Halle verlassen haben, ebenfalls schließen
create or replace function public.after_booking_hall_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select distinct l.rack, l.rack_column
    from public.locations l
    where l.area = 'hall'
      and l.id in (old.current_location_id, new.current_location_id)
  loop
    perform public.refresh_relocate_tasks(r.rack, r.rack_column);
  end loop;

  if new.current_location_id is distinct from old.current_location_id
     or new.status in ('completed', 'cancelled') then
    update public.tasks set status = 'done', note = coalesce(note || ' · ', '') || 'Konflikt aufgelöst'
    where type = 'relocate' and status in ('open', 'in_progress')
      and (booking_id = new.id or related_booking_id = new.id)
      and not exists (
        select 1 from public.locations l where l.id = new.current_location_id and l.area = 'hall'
      );
  end if;
  return null;
end;
$$;

create trigger bookings_hall_relocate
  after update of current_location_id, end_at, status on public.bookings
  for each row
  when (old.current_location_id is distinct from new.current_location_id
        or old.end_at is distinct from new.end_at
        or old.status is distinct from new.status)
  execute function public.after_booking_hall_change();

-- -----------------------------------------------------------------------------
-- Ein-/Auschecken und Umsetzen: einziger Schreibweg für Bewegungen aus der App
--   p_to_code null  = Fahrzeug übergeben (verlässt das Gelände, Schlüssel wird frei)
--   p_key_code      = Schlüsselfach beim Einchecken zuordnen
-- Liefert {movement_at, from, to, status, warnings[]}
-- -----------------------------------------------------------------------------
create or replace function public.move_vehicle(
  p_booking_id uuid,
  p_to_code text,
  p_reason text default null,
  p_key_code text default null
)
returns jsonb
language plpgsql
-- definer: nutzt interne Helfer (Belegung, Status-Neuberechnung); Zugriff wird unten geprüft
security definer
set search_path = public
as $$
declare
  b public.bookings;
  src public.locations;
  dst public.locations;
  v_blockers text;
  v_warnings text[] := '{}';
  v_status text;
  v_open integer;
begin
  if not public.is_staff() then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'Buchung nicht gefunden' using errcode = 'P0002';
  end if;
  if b.status in ('completed', 'cancelled') then
    raise exception 'Buchung ist % – keine Bewegung möglich', b.status using errcode = 'P0001';
  end if;

  select * into src from public.locations where id = b.current_location_id;
  if p_to_code is not null then
    select * into dst from public.locations
    where code = upper(btrim(p_to_code)) or qr_code = btrim(p_to_code);
    if dst.id is null then
      raise exception 'Platz „%“ unbekannt', p_to_code using errcode = 'P0002';
    end if;
    if dst.id = src.id then
      raise exception 'Fahrzeug steht bereits auf %', dst.code using errcode = 'P0001';
    end if;
    if not dst.active then
      raise exception 'Platz % ist deaktiviert', dst.code using errcode = 'P0001';
    end if;
    if public.location_occupancy(dst.id) >= dst.capacity then
      raise exception 'Platz % ist belegt', dst.code using errcode = 'P0001';
    end if;
  end if;

  -- Auslagern nur von unten nach oben
  if src.area = 'hall' then
    select string_agg(x.plate || ' (E' || l.level || ')', ', ' order by l.level) into v_blockers
    from public.locations l
    join public.bookings x on x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
    where l.area = 'hall' and l.rack = src.rack and l.rack_column = src.rack_column and l.level < src.level;
    if v_blockers is not null then
      raise exception 'Auslagern von % nicht möglich: darunter steht %. Zuerst umsetzen.', src.code, v_blockers
        using errcode = 'P0001';
    end if;
  end if;

  -- Einlagern nur von oben nach unten
  if dst.area = 'hall' then
    select string_agg(x.plate || ' (E' || l.level || ')', ', ' order by l.level) into v_blockers
    from public.locations l
    join public.bookings x on x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
    where l.area = 'hall' and l.rack = dst.rack and l.rack_column = dst.rack_column and l.level < dst.level;
    if v_blockers is not null then
      raise exception 'Platz % nur mit Umsetzen erreichbar: darunter steht %.', dst.code, v_blockers
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.locations l
      join public.bookings x on x.current_location_id = l.id and x.status not in ('completed', 'cancelled')
      where l.area = 'hall' and l.rack = dst.rack and l.rack_column = dst.rack_column
        and l.level > dst.level and x.end_at < b.end_at
    ) then
      v_warnings := v_warnings || format('Reihenfolge in Spalte R%s verletzt – Umsetz-Aufgabe wird angelegt.', dst.rack);
    end if;
    select count(*) into v_open from public.tasks
    where booking_id = b.id and status in ('open', 'in_progress') and type <> 'relocate';
    if v_open > 0 and dst.level > 1 then
      v_warnings := v_warnings || format('%s Leistung(en) offen – Arbeiten auf E%s kosten Umsetzvorgänge.', v_open, dst.level);
    end if;
  end if;

  insert into public.vehicle_movements (booking_id, from_location_id, to_location_id, reason)
  values (b.id, src.id, dst.id, nullif(btrim(coalesce(p_reason, '')), ''));

  -- Status-Flow
  v_status := case
    when dst.id is null then 'completed'
    when dst.area = 'transit' then 'in_transit'
    when dst.area in ('hall', 'outdoor_a', 'outdoor_b') and b.status in ('booked', 'arrived', 'in_transit') then 'stored'
    when dst.area in ('work', 'buffer') and b.status = 'booked' then 'arrived'
    when dst.area in ('work', 'buffer') and b.status = 'in_transit' then 'arrived'
    else b.status
  end;
  if v_status is distinct from b.status then
    update public.bookings set status = v_status where id = b.id;
    perform public.refresh_booking_readiness(b.id);
  end if;

  -- Schlüssel
  if p_key_code is not null and btrim(p_key_code) <> '' then
    update public.keys set booking_id = null where booking_id = b.id;
    update public.keys set booking_id = b.id
    where (key_code = upper(btrim(p_key_code)) or qr_code = btrim(p_key_code)) and booking_id is null;
    if not found then
      raise exception 'Schlüsselfach „%“ unbekannt oder belegt', p_key_code using errcode = 'P0001';
    end if;
  end if;
  if dst.id is null then
    update public.keys set booking_id = null where booking_id = b.id;
  end if;

  return jsonb_build_object(
    'from', src.code,
    'to', dst.code,
    'status', (select status from public.bookings where id = b.id),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

revoke execute on function
  public.refresh_relocate_tasks(integer, integer),
  public.after_booking_hall_change()
  from public, anon, authenticated;
revoke execute on function
  public.check_column(integer, integer),
  public.suggest_hall_location(uuid),
  public.move_vehicle(uuid, text, text, text)
  from public, anon;
grant execute on function
  public.check_column(integer, integer),
  public.suggest_hall_location(uuid),
  public.move_vehicle(uuid, text, text, text)
  to authenticated;

-- Bestehende Konflikte (z. B. Demo-Spalte R6) einmalig als Aufgaben anlegen
do $$
declare r record;
begin
  for r in select distinct rack, rack_column from public.locations where area = 'hall' loop
    perform public.refresh_relocate_tasks(r.rack, r.rack_column);
  end loop;
end;
$$;
