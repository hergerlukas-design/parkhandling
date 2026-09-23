-- =============================================================================
-- Zugriffsrechte (RLS), Realtime, Standard-Einstellungen
-- Nur freigeschaltetes internes Personal (profiles.active) hat Zugriff.
-- Katalog- und Betriebsdaten (settings, services, profiles) ändern nur Admins.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'settings', 'services', 'locations', 'bookings', 'booking_services', 'tasks',
    'media', 'vehicle_movements', 'keys', 'protocols', 'transport_jobs', 'transport_passengers',
    'booking_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- Lesen: gesamtes aktives Personal
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'services', 'locations', 'bookings', 'booking_services', 'tasks', 'media',
    'vehicle_movements', 'keys', 'protocols', 'transport_jobs', 'transport_passengers',
    'booking_history'
  ] loop
    execute format(
      'create policy staff_select on public.%I for select to authenticated using (public.is_staff())',
      t
    );
  end loop;
end;
$$;

-- Schreiben: Personal für operative Tabellen
do $$
declare
  t text;
begin
  foreach t in array array[
    'locations', 'bookings', 'booking_services', 'tasks', 'media', 'vehicle_movements', 'keys',
    'protocols', 'transport_jobs', 'transport_passengers'
  ] loop
    execute format(
      'create policy staff_insert on public.%I for insert to authenticated with check (public.is_staff())', t
    );
    execute format(
      'create policy staff_update on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t
    );
  end loop;
end;
$$;

-- Löschen operativer Daten nur für Admins (Stornieren statt Löschen)
do $$
declare
  t text;
begin
  foreach t in array array[
    'locations', 'bookings', 'booking_services', 'tasks', 'media', 'keys', 'protocols',
    'transport_jobs', 'transport_passengers'
  ] loop
    execute format(
      'create policy admin_delete on public.%I for delete to authenticated using (public.is_admin())', t
    );
  end loop;
end;
$$;

-- Bewegungs- und Buchungshistorie sind append-only (Historie wird nur per Trigger geschrieben)
revoke update, delete on public.vehicle_movements from authenticated;
revoke insert, update, delete on public.booking_history from authenticated;

-- Katalog/Einstellungen: nur Admins schreiben
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'services'] loop
    execute format(
      'create policy admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t
    );
  end loop;
end;
$$;

-- Profile: jeder sieht sich selbst, Personal sieht alle (Fahrerzuordnung), Admins verwalten
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Hilfsfunktionen für angemeldete Nutzer
grant execute on function public.is_staff(), public.is_admin(), public.get_setting(text, jsonb)
  to authenticated;
revoke execute on function public.refresh_location_status(uuid), public.refresh_location_and_column(uuid),
  public.ensure_service_task(uuid), public.refresh_booking_readiness(uuid),
  public.log_booking_change(uuid, jsonb)
  from public, anon;

-- -----------------------------------------------------------------------------
-- Realtime: nur Stellplätze, Aufgaben und Transportaufträge (Filter clientseitig im Abo)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.locations, public.tasks, public.transport_jobs;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Standard-Einstellungen (idempotent; bestehende Werte werden nicht überschrieben)
-- -----------------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('shuttle_hours', '{"start": "04:00", "end": "23:00"}',
   'Betriebszeiten Shuttle (Europe/Berlin)'),
  ('shuttle_interval_minutes', '60',
   'Takt der Standard-Shuttle-Slots in Minuten'),
  ('task_due_before_pickup_minutes', '120',
   'Leistungsaufgaben sind so viele Minuten vor Abholung fällig'),
  ('media_retention_days', 'null',
   'Aufbewahrungsfrist Vollbilder nach Buchungsabschluss in Tagen (rechtlich zu klären; null = unbegrenzt)'),
  ('email_triggers', '{"protocol_intake": true, "protocol_handover": true, "service_done": false, "pickup_reminder": false}',
   'Automatische Kunden-E-Mails einzeln aktivierbar'),
  ('email_templates', '{
      "protocol_intake": {"subject": "Ihr Annahmeprotokoll – {{plate}}", "body": "Guten Tag {{customer_name}},\n\nanbei erhalten Sie das Annahmeprotokoll für Ihr Fahrzeug {{plate}}.\n\nIhr Park & Fly Team"},
      "protocol_handover": {"subject": "Ihr Übergabeprotokoll – {{plate}}", "body": "Guten Tag {{customer_name}},\n\nanbei erhalten Sie das Übergabeprotokoll für Ihr Fahrzeug {{plate}}. Gute Heimfahrt!\n\nIhr Park & Fly Team"},
      "service_done": {"subject": "Aufbereitung abgeschlossen – {{plate}}", "body": "Guten Tag {{customer_name}},\n\ndie gebuchten Leistungen für Ihr Fahrzeug {{plate}} sind abgeschlossen.\n\nIhr Park & Fly Team"},
      "pickup_reminder": {"subject": "Ihre Abholung am {{end_date}}", "body": "Guten Tag {{customer_name}},\n\nwir freuen uns, Sie am {{end_date}} um {{end_time}} Uhr wieder zu begrüßen. Haben Sie Rückfragen? Antworten Sie einfach auf diese E-Mail.\n\nIhr Park & Fly Team"}
   }',
   'E-Mail-Vorlagen (Platzhalter in doppelten geschweiften Klammern)'),
  ('upload_limits', '{"max_bytes": 1500000, "max_uploads_per_minute": 60}',
   'Schutz vor Kostenexplosion: max. Dateigröße und Uploads pro Gerät und Minute')
on conflict (key) do nothing;
