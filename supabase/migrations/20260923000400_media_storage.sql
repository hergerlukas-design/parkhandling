-- =============================================================================
-- Media-Service: Upload-Metadaten, private Buckets, Storage-Rechte, Verbrauch
-- Additiv und abwärtskompatibel zu 0.2.0.
-- =============================================================================

alter table public.media
  add column if not exists created_by uuid references auth.users (id) on delete set null default auth.uid(),
  add column if not exists device_id text,
  add column if not exists mime_type text,
  add column if not exists thumb_bytes bigint not null default 0 check (thumb_bytes >= 0),
  -- null = Upload-URL ausgestellt, Datei aber noch nicht bestätigt hochgeladen
  add column if not exists uploaded_at timestamptz;

create index if not exists media_rate_limit_idx on public.media (created_by, device_id, created_at);
create index if not exists media_pending_idx on public.media (created_at) where uploaded_at is null;

-- -----------------------------------------------------------------------------
-- Buckets: privat, harte Größen- und Typgrenze serverseitig (Schutz vor Kostenexplosion).
-- Vollbilder sind clientseitig ~250 KB, Grenze 1,5 MB lässt Luft für PDFs.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('media', 'media', false, 1500000, array['image/webp', 'image/jpeg', 'image/png', 'application/pdf']),
  ('media-archive', 'media-archive', false, 1500000, array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lesen (für kurzlebige Signed URLs): Personal. Hochladen nur über Signed Upload URLs
-- der Edge Function media-sign – daher keine insert-Policy. Löschen/Verschieben: Admins.
create policy media_staff_read on storage.objects
  for select to authenticated
  using (bucket_id in ('media', 'media-archive') and public.is_staff());

create policy media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id in ('media', 'media-archive') and public.is_admin());

create policy media_admin_update on storage.objects
  for update to authenticated
  using (bucket_id in ('media', 'media-archive') and public.is_admin());

create policy media_admin_archive_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media-archive' and public.is_admin());

-- -----------------------------------------------------------------------------
-- Speicherverbrauch (Einstellungen → App & Version)
-- -----------------------------------------------------------------------------
create or replace function public.media_usage()
returns table (file_count bigint, total_bytes bigint, pending_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where uploaded_at is not null)
      + count(*) filter (where uploaded_at is not null and thumb_path is not null),
    coalesce(sum(bytes + thumb_bytes) filter (where uploaded_at is not null and archived_at is null), 0)::bigint,
    count(*) filter (where uploaded_at is null)
  from public.media
  where public.is_staff()
$$;

grant execute on function public.media_usage() to authenticated;
