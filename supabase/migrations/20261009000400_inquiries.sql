-- =============================================================================
-- Landingpage: Anfragen (Stufe 1)
--  * Eigene Tabelle `inquiries`, bewusst NICHT `bookings`: der Status-Flow der internen App
--    bleibt unverändert. Eine Anfrage wird vom Betrieb manuell bestätigt und ggf. später in
--    eine Buchung übernommen (`converted_booking_id`).
--  * Schreiben nur über die Edge Function `inquiry-submit` (service_role). Der Browser hat
--    keinerlei Rechte auf die Tabelle; Lesen/Status ändern nur für aktives Personal.
--  * Rate-Limit pro IP: `inquiry_rate_hits` speichert nur einen HMAC der IP, nie die IP selbst.
-- =============================================================================

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  arrival_date date not null,
  pickup_date date not null,
  parking_type text not null check (parking_type in ('indoor', 'outdoor_cover', 'outdoor', 'any')),
  plate text not null check (char_length(plate) between 1 and 15),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  phone text check (char_length(phone) <= 30),
  services text[] not null default '{}'
    check (services <@ array['shuttle', 'detailing', 'pickup_delivery']::text[]),
  message text check (char_length(message) <= 1000),
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'rejected')),
  converted_booking_id uuid references public.bookings (id) on delete set null,
  utm_source text check (char_length(utm_source) <= 200),
  utm_medium text check (char_length(utm_medium) <= 200),
  utm_campaign text check (char_length(utm_campaign) <= 200),
  utm_content text check (char_length(utm_content) <= 200),
  utm_term text check (char_length(utm_term) <= 200),
  referrer text check (char_length(referrer) <= 500),
  consent_privacy_at timestamptz not null,
  notification_status text check (notification_status in ('sent', 'not_configured', 'failed')),
  constraint inquiries_pickup_after_arrival check (pickup_date > arrival_date)
);

comment on table public.inquiries is
  'Unverbindliche Anfragen der Landingpage. Insert nur über Edge Function inquiry-submit.';
comment on column public.inquiries.notification_status is
  'Ergebnis der Benachrichtigungsmail an den Betrieb (sent, not_configured, failed).';

create index inquiries_status_created_idx on public.inquiries (status, created_at);
create index inquiries_email_idx on public.inquiries (email);

create trigger set_updated_at before update on public.inquiries
  for each row execute function public.set_updated_at();

alter table public.inquiries enable row level security;
revoke all on public.inquiries from public, anon, authenticated;
grant select, update on public.inquiries to authenticated;
grant all on public.inquiries to service_role;

create policy staff_select on public.inquiries
  for select to authenticated using ((select public.is_staff()));
create policy staff_update on public.inquiries
  for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- -----------------------------------------------------------------------------
-- Rate-Limit: höchstens p_limit Anfragen je IP-HMAC im Zeitfenster
-- -----------------------------------------------------------------------------
create table public.inquiry_rate_hits (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inquiry_rate_hits_ip_created_idx on public.inquiry_rate_hits (ip_hash, created_at);

alter table public.inquiry_rate_hits enable row level security;
revoke all on public.inquiry_rate_hits from public, anon, authenticated;
grant all on public.inquiry_rate_hits to service_role;

-- Zählt den Versuch und liefert true, solange das Limit nicht überschritten ist.
-- Advisory-Lock je IP-HMAC, damit parallele Anfragen das Limit nicht umgehen.
create or replace function public.inquiry_rate_check(
  p_ip_hash text,
  p_limit int default 5,
  p_window interval default interval '1 hour'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext('inquiry_rate:' || p_ip_hash));
  -- Alte Einträge dieser IP aufräumen (Datensparsamkeit)
  delete from public.inquiry_rate_hits
  where ip_hash = p_ip_hash and created_at < now() - greatest(p_window, interval '1 day');
  select count(*) into v_count
  from public.inquiry_rate_hits
  where ip_hash = p_ip_hash and created_at > now() - p_window;
  if v_count >= p_limit then
    return false;
  end if;
  insert into public.inquiry_rate_hits (ip_hash) values (p_ip_hash);
  return true;
end;
$$;

revoke execute on function public.inquiry_rate_check(text, int, interval) from public, anon, authenticated;
grant execute on function public.inquiry_rate_check(text, int, interval) to service_role;

-- -----------------------------------------------------------------------------
-- Einstellungen (bestehende Werte bleiben)
-- -----------------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('inquiry_notify_address', 'null',
   'Empfänger der Benachrichtigung über neue Anfragen. null = settings.mail_test_address (bis Go-live)'),
  ('inquiry_customer_confirmation', 'false',
   'Bestätigungsmail an den Kunden nach einer Anfrage (aus, bis Mail-Anbieter und Datenschutz geklärt sind)')
on conflict (key) do nothing;
