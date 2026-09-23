-- =============================================================================
-- Härtung nach Supabase-Advisor (Sicherheit + Performance). Additiv, keine Schemaänderung.
-- =============================================================================

-- Feste search_path für alle Hilfs- und Triggerfunktionen
alter function public.set_updated_at() set search_path = public;
alter function public.new_portal_token() set search_path = public;
alter function public.normalize_plate(text) set search_path = public;
alter function public.task_type_for_category(text) set search_path = public;
alter function public.before_booking_service_update() set search_path = public;
alter function public.before_task_write() set search_path = public;

-- Triggerfunktionen und interne Funktionen nicht per /rest/v1/rpc aufrufbar machen.
-- (EXECUTE wird nur beim Anlegen des Triggers geprüft, nicht beim Auslösen.)
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

-- Nur für angemeldete Nutzer (in RLS-Policies bzw. Einstellungen benötigt)
revoke execute on function public.is_staff(), public.is_admin(), public.media_usage() from public, anon;
grant execute on function public.is_staff(), public.is_admin(), public.media_usage() to authenticated;

-- -----------------------------------------------------------------------------
-- Policies: Funktionsaufrufe über (select …) einmal pro Statement auswerten und
-- überlappende permissive Policies (admin_write "for all" + staff_select) auflösen.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'services', 'locations', 'bookings', 'booking_services', 'tasks', 'media',
    'vehicle_movements', 'keys', 'protocols', 'transport_jobs', 'transport_passengers',
    'booking_history'
  ] loop
    execute format('drop policy if exists staff_select on public.%I', t);
    execute format(
      'create policy staff_select on public.%I for select to authenticated using ((select public.is_staff()))', t
    );
  end loop;

  foreach t in array array[
    'locations', 'bookings', 'booking_services', 'tasks', 'media', 'vehicle_movements', 'keys',
    'protocols', 'transport_jobs', 'transport_passengers'
  ] loop
    execute format('drop policy if exists staff_insert on public.%I', t);
    execute format('drop policy if exists staff_update on public.%I', t);
    execute format(
      'create policy staff_insert on public.%I for insert to authenticated with check ((select public.is_staff()))', t
    );
    execute format(
      'create policy staff_update on public.%I for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t
    );
  end loop;

  foreach t in array array[
    'locations', 'bookings', 'booking_services', 'tasks', 'media', 'keys', 'protocols',
    'transport_jobs', 'transport_passengers'
  ] loop
    execute format('drop policy if exists admin_delete on public.%I', t);
    execute format(
      'create policy admin_delete on public.%I for delete to authenticated using ((select public.is_admin()))', t
    );
  end loop;

  foreach t in array array['settings', 'services'] loop
    execute format('drop policy if exists admin_write on public.%I', t);
    execute format(
      'create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_admin()))', t
    );
    execute format(
      'create policy admin_update on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t
    );
    execute format(
      'create policy admin_delete on public.%I for delete to authenticated using ((select public.is_admin()))', t
    );
  end loop;
end;
$$;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;
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

drop policy if exists media_staff_read on storage.objects;
drop policy if exists media_admin_delete on storage.objects;
drop policy if exists media_admin_update on storage.objects;
drop policy if exists media_admin_archive_insert on storage.objects;
create policy media_staff_read on storage.objects
  for select to authenticated
  using (bucket_id in ('media', 'media-archive') and (select public.is_staff()));
create policy media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id in ('media', 'media-archive') and (select public.is_admin()));
create policy media_admin_update on storage.objects
  for update to authenticated
  using (bucket_id in ('media', 'media-archive') and (select public.is_admin()));
create policy media_admin_archive_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media-archive' and (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Indizes für Fremdschlüssel
-- -----------------------------------------------------------------------------
create index if not exists booking_history_changed_by_idx on public.booking_history (changed_by);
create index if not exists booking_services_service_idx on public.booking_services (service_id);
create index if not exists protocols_created_by_idx on public.protocols (created_by);
create index if not exists protocols_pdf_media_idx on public.protocols (pdf_media_id);
create index if not exists protocols_signature_media_idx on public.protocols (signature_media_id);
create index if not exists tasks_booking_service_idx on public.tasks (booking_service_id);
create index if not exists tasks_done_by_idx on public.tasks (done_by);
create index if not exists tasks_service_idx on public.tasks (service_id);
create index if not exists transport_jobs_driver_idx on public.transport_jobs (driver_id);
create index if not exists vehicle_movements_from_location_idx on public.vehicle_movements (from_location_id);
create index if not exists vehicle_movements_to_location_idx on public.vehicle_movements (to_location_id);
create index if not exists vehicle_movements_moved_by_idx on public.vehicle_movements (moved_by);
