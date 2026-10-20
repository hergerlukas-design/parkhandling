-- Aufbewahrung (0.22.0): fällig sind nur Vollbild-Fotos mit Thumbnail aus abgeschlossenen bzw.
-- stornierten Buchungen, deren Ende länger als media_retention_days zurückliegt
\set ON_ERROR_STOP 1
\o /dev/null

create or replace function pg_temp.assert_eq(actual anyelement, expected anyelement, msg text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FEHLER: % (erwartet %, erhalten %)', msg, expected, actual;
  end if;
end;
$$;

create or replace function pg_temp.error_of(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type)
values ('manual', 'RET-ALT', 'Alt', 'M-RE 1', now() - interval '420 days', now() - interval '400 days', 'outdoor')
returning id as old_bid \gset
update public.bookings set status = 'completed' where id = :'old_bid';

insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type)
values ('manual', 'RET-OFFEN', 'Offen', 'M-RE 2', now() - interval '420 days', now() - interval '400 days', 'outdoor')
returning id as open_bid \gset

insert into public.bookings (source, external_ref, customer_name, plate, start_at, end_at, parking_type)
values ('manual', 'RET-NEU', 'Neu', 'M-RE 3', now() - interval '20 days', now() - interval '10 days', 'outdoor')
returning id as new_bid \gset
update public.bookings set status = 'completed' where id = :'new_bid';

insert into public.media (booking_id, owner_type, kind, bucket, path, thumb_path, bytes, thumb_bytes, uploaded_at) values
  (:'old_bid', 'task', 'photo', 'media', 'ret/faellig.webp', 'ret/faellig_t.webp', 1000, 50, now()),
  (:'old_bid', 'task', 'photo', 'media', 'ret/ohne-thumb.webp', null, 1000, 0, now()),
  (:'old_bid', 'protocol', 'signature', 'media', 'ret/sig.png', null, 1000, 0, now()),
  (:'old_bid', 'protocol', 'pdf', 'media', 'ret/p.pdf', null, 1000, 0, now()),
  (:'old_bid', 'task', 'photo', 'media', 'ret/nicht-hochgeladen.webp', 'ret/n_t.webp', 1000, 50, null),
  (:'open_bid', 'task', 'photo', 'media', 'ret/offen.webp', 'ret/offen_t.webp', 1000, 50, now()),
  (:'new_bid', 'task', 'photo', 'media', 'ret/neu.webp', 'ret/neu_t.webp', 1000, 50, now());

-- Nur das eine Vollbild ist fällig
select pg_temp.assert_eq((select string_agg(path, ',') from public.media_retention_due(100)), 'ret/faellig.webp',
  'nur Foto mit Thumbnail aus abgeschlossener, alter Buchung');

-- Frist verkürzen: die junge Buchung wird fällig
update public.settings set value = '5' where key = 'media_retention_days';
select pg_temp.assert_eq((select count(*)::int from public.media_retention_due(100)), 2, 'kürzere Frist erfasst mehr Fotos');
select pg_temp.assert_eq((select count(*)::int from public.media_retention_due(1)), 1, 'Stapelgröße wird eingehalten');
update public.settings set value = '365' where key = 'media_retention_days';

-- Archivierte Fotos sind nicht mehr fällig, ihr Thumbnail zählt weiter zum Speicher
update public.media set archived_at = now() where path = 'ret/faellig.webp';
select pg_temp.assert_eq((select count(*)::int from public.media_retention_due(100)), 0, 'archiviert = erledigt');

-- Ausgeschalteter Job ruft nichts auf
select pg_temp.assert_eq(public.media_retention_tick(), 'aus', 'Job ist standardmäßig aus');
update public.settings set value = 'true' where key = 'media_retention_job_enabled';
select pg_temp.assert_eq(public.media_retention_tick(), 'kein Vault', 'ohne Vault (lokal) kein Aufruf');
update public.settings set value = 'false' where key = 'media_retention_job_enabled';
select pg_temp.assert_eq(public.media_retention_check_secret('x'), false, 'ohne Vault kein gültiges Geheimnis');

-- Rechte: Vorschau nur für Admins, Kandidatenliste und Tick gar nicht für angemeldete Nutzer
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'ret-admin@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'ret-personal@example.com');
update public.profiles set active = true, role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set active = true, role = 'staff' where id = '00000000-0000-0000-0000-0000000000b2';
update public.media set archived_at = null where path = 'ret/faellig.webp';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.assert_eq(pg_temp.error_of('select * from public.media_retention_preview()'), 'Nur Admins', 'Personal sieht keine Vorschau');
select pg_temp.assert_eq(pg_temp.error_of('select * from public.media_retention_due(10)') like 'permission denied%', true,
  'Kandidatenliste nicht für Nutzer');
select pg_temp.assert_eq(pg_temp.error_of('select public.media_retention_tick()') like 'permission denied%', true,
  'Tick nicht für Nutzer');
select pg_temp.assert_eq((select count(*)::int from public.media_retention_runs), 0, 'Personal sieht keine Läufe');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.assert_eq((select due_count::int from public.media_retention_preview()), 1, 'Admin-Vorschau zählt fällige Fotos');
select pg_temp.assert_eq((select due_bytes::int from public.media_retention_preview()), 1000, 'Admin-Vorschau summiert Bytes');
reset role;

\o
\echo '  ✓ 80_media_retention'
