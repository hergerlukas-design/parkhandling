-- =============================================================================
-- Zugriffsrechte (RLS), Realtime, Standard-Einstellungen
-- Nur freigeschaltetes internes Personal (profiles.active) hat Zugriff.
-- Rollen: staff (operativ), admin (zusätzlich Katalog, Einstellungen, Personal, Löschen).
-- Policies rufen Funktionen über (select …) auf → einmal pro Abfrage statt pro Zeile.
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

  -- Lesen: gesamtes aktives Personal
  foreach t in array array[
    'settings', 'services', 'locations', 'bookings', 'booking_services', 'tasks', 'media',
    'vehicle_movements', 'keys', 'protocols', 'transport_jobs', 'transport_passengers',
    'booking_history'
  ] loop
    execute format(
      'create policy staff_select on public.%I for select to authenticated using ((select public.is_staff()))', t
    );
  end loop;

  -- Schreiben: Personal für operative Tabellen
  foreach t in array array[
    'locations', 'bookings', 'booking_services', 'tasks', 'media', 'vehicle_movements', 'keys',
    'protocols', 'transport_jobs', 'transport_passengers'
  ] loop
    execute format(
      'create policy staff_insert on public.%I for insert to authenticated with check ((select public.is_staff()))', t
    );
    execute format(
      'create policy staff_update on public.%I for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t
    );
  end loop;

  -- Löschen nur für Admins (fachlich wird storniert, nicht gelöscht)
  foreach t in array array[
    'locations', 'bookings', 'booking_services', 'tasks', 'media', 'keys', 'protocols',
    'transport_jobs', 'transport_passengers', 'settings', 'services'
  ] loop
    execute format(
      'create policy admin_delete on public.%I for delete to authenticated using ((select public.is_admin()))', t
    );
  end loop;

  -- Katalog und Einstellungen: nur Admins schreiben
  foreach t in array array['settings', 'services'] loop
    execute format(
      'create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_admin()))', t
    );
    execute format(
      'create policy admin_update on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t
    );
  end loop;
end;
$$;

-- Bewegungs- und Buchungshistorie sind append-only
revoke update, delete on public.vehicle_movements from authenticated;
revoke insert, update, delete on public.booking_history from authenticated;

-- Profile: jeder sieht sich selbst, Personal sieht alle, Admins verwalten
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check ((select public.is_admin()));
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy profiles_admin_delete on public.profiles
  for delete to authenticated using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Funktionen: Trigger und interne Helfer nicht per /rest/v1/rpc aufrufbar
-- (EXECUTE wird nur beim Anlegen des Triggers geprüft, nicht beim Auslösen.)
-- -----------------------------------------------------------------------------
revoke execute on function
  public.handle_new_user(),
  public.on_vehicle_movement_insert(),
  public.after_vehicle_movement_insert(),
  public.after_booking_location_change(),
  public.after_booking_insert_defaults(),
  public.after_booking_service_change(),
  public.after_task_change(),
  public.after_booking_update_history(),
  public.location_occupancy(uuid),
  public.refresh_location_status(uuid),
  public.refresh_location_and_column(uuid),
  public.ensure_service_task(uuid),
  public.refresh_booking_readiness(uuid),
  public.log_booking_change(uuid, jsonb),
  public.get_setting(text, jsonb)
  from public, anon, authenticated;

revoke execute on function public.is_staff(), public.is_admin() from public, anon;
grant execute on function public.is_staff(), public.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: nur Stellplätze, Aufgaben und Transportaufträge (Filter im Abo)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.locations, public.tasks, public.transport_jobs;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Standard-Einstellungen (Werte laut ANNAHMEN.md; bestehende Werte bleiben)
-- -----------------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('shuttle_hours', '{"start": "05:00", "end": "23:00"}',
   'Betriebszeiten Shuttle (Europe/Berlin)'),
  ('shuttle_interval_minutes', '60',
   'Takt der Standard-Shuttle-Slots in Minuten'),
  ('shuttle_capacity', '8',
   'Sitzplätze pro Shuttle-Bus'),
  ('task_due_before_pickup_minutes', '120',
   'Leistungsaufgaben sind so viele Minuten vor Abholung fällig'),
  ('relocate_lead_minutes', '60',
   'Umsetz-Aufgaben sind so viele Minuten vor der früheren Abholung fällig'),
  ('mail_test_address', '"test@example.com"',
   'Prototyp: ALLE Mails gehen ausschließlich an diese Adresse'),
  ('mail_mode', '"test"',
   'test = nur an mail_test_address; live = an Kunden (noch nicht freigegeben)'),
  ('media_retention_days', '365',
   'Aufbewahrungsfrist Vollbilder nach Buchungsabschluss in Tagen (Platzhalter, rechtlich zu klären)'),
  ('media_retention_job_enabled', 'false',
   'Täglicher Lösch-/Archivjob aktiv (im Prototyp deaktiviert)'),
  ('email_triggers', '{"protocol_intake": true, "protocol_handover": true, "service_done": false, "pickup_reminder": false}',
   'Automatische Mails einzeln aktivierbar'),
  ('email_templates', '{
      "protocol_intake": {"subject": "Ihr Annahmeprotokoll – {{plate}}", "body": "Guten Tag {{customer_name}},\n\nanbei erhalten Sie das Annahmeprotokoll für Ihr Fahrzeug {{plate}}.\n\nIhr Park & Fly Team"},
      "protocol_handover": {"subject": "Ihr Übergabeprotokoll – {{plate}}", "body": "Guten Tag {{customer_name}},\n\nanbei erhalten Sie das Übergabeprotokoll für Ihr Fahrzeug {{plate}}. Gute Heimfahrt!\n\nIhr Park & Fly Team"},
      "service_done": {"subject": "Aufbereitung abgeschlossen – {{plate}}", "body": "Guten Tag {{customer_name}},\n\ndie gebuchten Leistungen für Ihr Fahrzeug {{plate}} sind abgeschlossen.\n\nIhr Park & Fly Team"},
      "pickup_reminder": {"subject": "Ihre Abholung am {{end_date}}", "body": "Guten Tag {{customer_name}},\n\nwir freuen uns, Sie am {{end_date}} um {{end_time}} Uhr wieder zu begrüßen.\n\nIhr Park & Fly Team"}
   }',
   'E-Mail-Vorlagen (Platzhalter in doppelten geschweiften Klammern)'),
  ('upload_limits', '{"max_bytes": 1500000, "max_uploads_per_minute": 60}',
   'Schutz vor Kostenexplosion: max. Dateigröße und Uploads pro Gerät und Minute')
on conflict (key) do nothing;
