-- =============================================================================
-- Online-Widerruf der Landingpage (AGB Ziffer 12.2, § 356a BGB)
--  * booking_withdrawals: eingegangene Widerrufserklärungen mit Zeitpunkt des Eingangs
--  * Schreibzugriff nur über die Edge Function booking-checkout (service_role)
--  * Personal sieht die Eingänge, ändert sie aber nicht
-- =============================================================================

create table public.booking_withdrawals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete set null,
  booking_ref text not null check (booking_ref ~ '^PF-[0-9A-F]{8}$'),
  customer_name text not null,
  customer_email text not null,
  reason text,
  -- Zeitpunkt des Eingangs der Erklärung (maßgeblich für die Eingangsbestätigung)
  received_at timestamptz not null default now(),
  -- true, wenn der Eingang innerhalb von 14 Tagen nach der Buchung liegt
  within_period boolean not null,
  confirmation_sent boolean not null default false,
  ip_hash text,
  created_at timestamptz not null default now()
);

create unique index booking_withdrawals_ref_key on public.booking_withdrawals (booking_ref);

alter table public.booking_withdrawals enable row level security;

create policy booking_withdrawals_staff_select on public.booking_withdrawals
  for select to authenticated using (public.is_staff());
