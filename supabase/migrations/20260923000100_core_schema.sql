-- =============================================================================
-- Park & Fly Manager – Grundschema
-- Konventionen:
--   * Jede Tabelle hat id (uuid), created_at, updated_at.
--   * Aufzählungen als text + check (per additiver Migration erweiterbar, abwärtskompatibel).
--   * Keine Binärdaten in Postgres – Dateien liegen im Storage, hier nur provider/bucket/path.
--   * vehicle_movements und booking_history haben einen zusammengesetzten Primärschlüssel
--     (id, Zeitstempel), damit sie später nach Jahr partitioniert werden können.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Hilfsfunktionen
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.new_portal_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create or replace function public.normalize_plate(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9ÄÖÜäöü]', '', 'g'))
$$;

-- -----------------------------------------------------------------------------
-- Personal (nur internes Personal nutzt die App)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('admin', 'staff', 'driver')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.active is
  'Neue Konten sind inaktiv, bis ein Admin sie freischaltet.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin')
$$;

-- -----------------------------------------------------------------------------
-- Einstellungen (Betriebsparameter, Mail-Vorlagen, Fristen)
-- -----------------------------------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.get_setting(p_key text, p_default jsonb default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.settings where key = p_key), p_default)
$$;

-- -----------------------------------------------------------------------------
-- Leistungskatalog
-- -----------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  -- Freie Kategorie. 'charge' und 'fuel' erzeugen Aufgaben vom Typ charge/fuel.
  category text not null default 'cleaning',
  price numeric(10, 2) not null default 0 check (price >= 0),
  active boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Orte (Stellplätze, Arbeitsplätze, Puffer, unterwegs)
-- -----------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  area text not null check (area in ('hall', 'outdoor_a', 'outdoor_b', 'work', 'buffer', 'transit')),
  -- Nur Halle: Regal, Spalte im Regal, Ebene 1 (unten) bis 3 (oben)
  rack integer,
  rack_column integer,
  level smallint check (level between 1 and 3),
  -- Nur Außen: Reihe und Platznummer
  "row" text,
  number integer,
  has_cover boolean not null default false,
  -- Wie viele Fahrzeuge gleichzeitig hier stehen können (Arbeits-/Transitflächen > 1)
  capacity integer not null default 1 check (capacity > 0),
  -- free/occupied/blocked werden per Trigger berechnet, reserved wird manuell gesetzt
  status text not null default 'free' check (status in ('free', 'occupied', 'reserved', 'blocked')),
  qr_code text unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_hall_coordinates check (
    area <> 'hall' or (rack is not null and rack_column is not null and level is not null)
  )
);

create unique index locations_hall_slot_uidx
  on public.locations (rack, rack_column, level)
  where area = 'hall';

-- -----------------------------------------------------------------------------
-- Buchungen (eine Buchung = ein Fahrzeug-Case)
-- -----------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  external_ref text,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  plate text not null,
  plate_normalized text generated always as (public.normalize_plate(plate)) stored,
  vehicle_model text,
  persons smallint not null default 1 check (persons between 0 and 50),
  start_at timestamptz not null,
  end_at timestamptz not null,
  parking_type text not null check (parking_type in ('indoor', 'outdoor_cover', 'outdoor')),
  return_mode text not null default 'shuttle' check (return_mode in ('shuttle', 'vallet', 'self')),
  status text not null default 'booked' check (
    status in ('booked', 'arrived', 'stored', 'in_service', 'ready', 'in_transit', 'completed', 'cancelled')
  ),
  current_location_id uuid references public.locations (id) on delete set null,
  portal_token text not null unique default public.new_portal_token(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_period check (end_at > start_at),
  constraint bookings_source_ref_key unique (source, external_ref)
);

comment on column public.bookings.portal_token is
  'Vorbereitet für ein späteres Kundenportal. Wird derzeit nicht verwendet.';
comment on column public.bookings.current_location_id is
  'Denormalisiert: Zielort der letzten vehicle_movements-Zeile (per Trigger gepflegt).';

-- -----------------------------------------------------------------------------
-- Gebuchte Leistungen
-- -----------------------------------------------------------------------------
create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  service_id uuid not null references public.services (id),
  price_at_booking numeric(10, 2) not null default 0,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, service_id)
);

-- -----------------------------------------------------------------------------
-- Aufgaben / Teilschritte
-- -----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  type text not null check (type in ('service', 'charge', 'fuel', 'relocate')),
  service_id uuid references public.services (id),
  booking_service_id uuid references public.booking_services (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  title text,
  due_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Medien (Fotos, Unterschriften, PDFs) – nur Verweise, keine Binärdaten
-- -----------------------------------------------------------------------------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete set null,
  owner_type text not null check (owner_type in ('task', 'protocol', 'damage')),
  owner_id uuid,
  kind text not null check (kind in ('photo', 'signature', 'pdf')),
  provider text not null default 'supabase' check (provider in ('supabase', 'r2')),
  bucket text not null,
  path text not null,
  thumb_path text,
  width integer,
  height integer,
  bytes bigint not null default 0 check (bytes >= 0),
  taken_at timestamptz,
  retention_until timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, bucket, path)
);

-- -----------------------------------------------------------------------------
-- Bewegungshistorie (partitionierbar nach moved_at)
-- -----------------------------------------------------------------------------
create table public.vehicle_movements (
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  from_location_id uuid references public.locations (id),
  -- null = Fahrzeug hat das Gelände verlassen (übergeben)
  to_location_id uuid references public.locations (id),
  moved_by uuid references auth.users (id) on delete set null,
  moved_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, moved_at)
);

-- -----------------------------------------------------------------------------
-- Schlüssel
-- -----------------------------------------------------------------------------
create table public.keys (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete set null,
  key_code text not null unique,
  storage_place text,
  qr_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Protokolle (Annahme / Übergabe)
-- -----------------------------------------------------------------------------
create table public.protocols (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  type text not null check (type in ('intake', 'handover')),
  mileage integer check (mileage >= 0),
  fuel_level smallint check (fuel_level between 0 and 100),
  soc_percent smallint check (soc_percent between 0 and 100),
  damages jsonb not null default '[]'::jsonb,
  remarks text,
  signature_media_id uuid references public.media (id) on delete set null,
  pdf_media_id uuid references public.media (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Shuttle & Vallet
-- -----------------------------------------------------------------------------
create table public.transport_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('shuttle_slot', 'premium_on_demand', 'vallet')),
  direction text not null check (direction in ('to_airport', 'from_airport')),
  scheduled_at timestamptz not null,
  driver_id uuid references public.profiles (id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'assigned', 'underway', 'done', 'cancelled')),
  meeting_point text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index transport_jobs_shuttle_slot_uidx
  on public.transport_jobs (direction, scheduled_at)
  where type = 'shuttle_slot';

create table public.transport_passengers (
  id uuid primary key default gen_random_uuid(),
  transport_job_id uuid not null references public.transport_jobs (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  persons smallint not null default 1 check (persons between 0 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transport_job_id, booking_id)
);

-- -----------------------------------------------------------------------------
-- Buchungshistorie (Umbuchungen, Leistungsänderungen; partitionierbar nach changed_at)
-- -----------------------------------------------------------------------------
create table public.booking_history (
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  changed_fields jsonb not null,
  source text not null default 'app',
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, changed_at)
);

-- -----------------------------------------------------------------------------
-- updated_at-Trigger für alle Tabellen
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'settings', 'services', 'locations', 'bookings', 'booking_services', 'tasks',
    'media', 'vehicle_movements', 'keys', 'protocols', 'transport_jobs', 'transport_passengers',
    'booking_history'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Indizes (Abschnitt 11.5)
-- -----------------------------------------------------------------------------
create index bookings_status_end_at_idx on public.bookings (status, end_at);
create index bookings_plate_idx on public.bookings (plate);
create index bookings_plate_normalized_idx on public.bookings (plate_normalized text_pattern_ops);
create index bookings_start_at_idx on public.bookings (start_at);
create index bookings_current_location_idx on public.bookings (current_location_id)
  where current_location_id is not null;
create index booking_services_booking_idx on public.booking_services (booking_id);
create index locations_area_status_idx on public.locations (area, status);
create index tasks_status_due_at_idx on public.tasks (status, due_at);
create index tasks_booking_idx on public.tasks (booking_id);
create index vehicle_movements_booking_moved_at_idx on public.vehicle_movements (booking_id, moved_at);
create index media_booking_idx on public.media (booking_id);
create index media_retention_until_idx on public.media (retention_until) where retention_until is not null;
create index media_owner_idx on public.media (owner_type, owner_id);
create index keys_booking_idx on public.keys (booking_id);
create index protocols_booking_idx on public.protocols (booking_id, type);
create index transport_jobs_scheduled_at_idx on public.transport_jobs (scheduled_at, status);
create index transport_passengers_booking_idx on public.transport_passengers (booking_id);
create index booking_history_booking_idx on public.booking_history (booking_id, changed_at);
