-- =============================================================================
-- Online-Buchung über die Landingpage (landing/ Stufe 2)
--  * booking_tariffs: die vier Tarife aus der Preiskategorien-Vorlage (Preise pro Dauerklasse)
--  * booking_checkouts: Zwischenspeicher zwischen PayPal-Bestellung und Zahlung.
--    Die Buchung entsteht erst nach erfolgreicher Zahlung (siehe Edge Function booking-checkout).
--  * Schreibzugriff nur über den service_role (Edge Function). Anonyme Nutzer lesen direkt nichts.
-- =============================================================================

create table public.booking_tariffs (
  code text primary key,
  label text not null,
  -- Bereich bestimmt die Stellplatzart der Buchung (indoor / outdoor_cover / outdoor)
  parking_type text not null check (parking_type in ('indoor', 'outdoor_cover', 'outdoor')),
  shuttle_text text not null,
  included_text text not null,
  -- Preise brutto in EUR (Annahme, MwSt.-Angabe noch zu bestätigen)
  price_week numeric(10, 2) not null check (price_week >= 0),     -- 5 bis 8 Tage
  price_holiday numeric(10, 2) not null check (price_holiday >= 0), -- 9 bis 15 Tage
  price_month numeric(10, 2) not null check (price_month >= 0),   -- 16 bis 30 Tage
  active boolean not null default true,
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.booking_tariffs
  (code, label, parking_type, shuttle_text, included_text, price_week, price_holiday, price_month, sort_order)
values
  ('economy', 'Economy', 'outdoor', 'Alle 60 Minuten',
   'Außenstellplatz 12 m², abgesperrtes Gelände, Videoüberwachung, Annahme/Ausgabe & ParkHandling',
   89.00, 129.00, 179.00, 1),
  ('space', 'Space', 'outdoor_cover', 'Alle 60 Minuten',
   'Außenstellplatz 15 m², abgesperrtes Gelände, Videoüberwachung, Grob-Reinigung Interieur, Wetterschutzplane Outdoor, Annahme/Ausgabe & ParkHandling',
   95.00, 138.00, 199.00, 2),
  ('business', 'Business', 'indoor', 'Alle 30 Minuten',
   'Innenstellplatz im Park-Regal, doppelt gesicherte Fahrzeughalle, klimatisiert 18 °C, Grob-Reinigung Interieur, Annahme/Ausgabe & ParkHandling',
   125.00, 195.00, 299.00, 3),
  ('premium', 'Premium', 'indoor', 'Direkt',
   'Innenstellplatz im Park-Regal, doppelt gesicherte Fahrzeughalle, klimatisiert 18 °C, Grundreinigung Interieur, CarCover Satin Indoor, Prüfung Luftdruck und Betriebsflüssigkeiten, Annahme/Ausgabe & ParkHandling',
   148.00, 249.00, 369.00, 4)
on conflict (code) do nothing;

alter table public.booking_tariffs enable row level security;

-- Personal darf die Tarife sehen und pflegen; anonyme Besucher lesen sie über die Edge Function
create policy booking_tariffs_staff_select on public.booking_tariffs
  for select to authenticated using (public.is_staff());
create policy booking_tariffs_admin_write on public.booking_tariffs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Checkout: eine PayPal-Bestellung, bis die Zahlung abgeschlossen ist
-- -----------------------------------------------------------------------------
create table public.booking_checkouts (
  id uuid primary key default gen_random_uuid(),
  tariff_code text not null references public.booking_tariffs (code),
  -- geprüfte Buchungsdaten aus dem Formular (ohne Betrag, der wird serverseitig berechnet)
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  amount numeric(10, 2) not null check (amount > 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  paypal_order_id text unique,
  status text not null default 'pending' check (status in ('pending', 'captured', 'failed')),
  booking_id uuid references public.bookings (id) on delete set null,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_checkouts_status_idx on public.booking_checkouts (status, created_at);

alter table public.booking_checkouts enable row level security;
-- keine Policies: nur der service_role (Edge Function) greift zu

-- Einstellungen für Buchungsbestätigungen (Platzhalter, bis die Absenderadresse feststeht)
insert into public.settings (key, value, description) values
  ('booking_confirmation_from', '"booking@parkhandling.de"',
   'Absender der Buchungsbestätigung (Platzhalter, Adresse noch zu bestätigen)')
on conflict (key) do nothing;
