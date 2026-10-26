-- Tests für Push-Benachrichtigungen (Outbox, Dedupe, Zeitplan, Empfänger, Rückmeldung)
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

create or replace function pg_temp.n(p_event text, p_ref uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications where event = p_event and ref_id = p_ref
$$;

-- Konten: Admin, Personal S (bekommt Pushs), Personal T (löst aus)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'admin-push@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'staff-push@example.com'),
  ('00000000-0000-0000-0000-0000000000f3', 'other-push@example.com');
update public.profiles set active = true, role = 'admin' where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set active = true where id in ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3');

-- Rollen-Vorbelegung
select pg_temp.assert_eq('booking_review' = any (public.default_push_events('staff')), false, 'Personal: kein booking_review');
select pg_temp.assert_eq('booking_review' = any (public.default_push_events('admin')), true, 'Admin: booking_review');
select pg_temp.assert_eq(cardinality(public.default_push_events('staff')), 8, 'Personal: 8 Ereignisse (inkl. charging_ended)');

set role authenticated;

-- Geräte anmelden
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select (public.save_push_subscription('https://push.example.com/admin', 'k', 'a', 'Büro', 'dev-admin', 'test') ).id as sub_admin \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select (public.save_push_subscription('https://push.example.com/staff', 'k', 'a', 'Tablet Halle', 'dev-staff', 'test')).id as sub_staff \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
select (public.save_push_subscription('https://push.example.com/other', 'k', 'a', 'Handy', 'dev-other', 'test')).id as sub_other \gset

-- Fremde Abos sind für Personal unsichtbar, eigene sichtbar
select pg_temp.assert_eq((select count(*)::int from public.push_subscriptions), 1, 'Personal sieht nur eigenes Abo');
-- Outbox ist für Personal nicht lesbar
select pg_temp.assert_eq((select count(*)::int from public.notifications), 0, 'Personal sieht keine Outbox');

-- Neue Buchung durch T → booking_new, T selbst ausgeschlossen
select (public.upsert_booking('{
  "external_ref": "PN01", "customer_name": "Erika Beispiel", "plate": "M-PN 101",
  "start_at": "2030-10-25T10:00:00+02:00", "end_at": "2030-10-27T12:00:00+01:00",
  "parking_type": "outdoor", "return_mode": "self"
}'::jsonb, 'test') ->> 'id') as b1 \gset

-- Umbuchung (Abholung später) → booking_changed; gleiche Daten erneut → kein zweites Mal
select public.upsert_booking('{"external_ref": "PN01", "end_at": "2030-10-27T14:00:00+01:00"}'::jsonb, 'test') \gset
select public.upsert_booking('{"external_ref": "PN01", "end_at": "2030-10-27T14:00:00+01:00"}'::jsonb, 'test') \gset

reset role;
select pg_temp.assert_eq(pg_temp.n('booking_new', :'b1'), 1, 'booking_new genau einmal');
select pg_temp.assert_eq(
  (select exclude_user_id from public.notifications where event = 'booking_new' and ref_id = :'b1'),
  '00000000-0000-0000-0000-0000000000f3'::uuid, 'Auslöser ausgeschlossen');
select pg_temp.assert_eq(
  (select payload ->> 'title' from public.notifications where event = 'booking_new' and ref_id = :'b1'),
  'Neue Buchung M-PN 101', 'Titel booking_new');
select pg_temp.assert_eq(
  (select payload ->> 'body' from public.notifications where event = 'booking_new' and ref_id = :'b1'),
  '25.10. 10:00 – 27.10. 12:00 · Außen ohne Plane · Test', 'Text booking_new');
select pg_temp.assert_eq(pg_temp.n('booking_changed', :'b1'), 1, 'booking_changed einmal');
select pg_temp.assert_eq(
  (select payload ->> 'body' from public.notifications where event = 'booking_changed' and ref_id = :'b1'),
  'Abholung jetzt 27.10. 14:00', 'Text Umbuchung');
-- Kein Kundenname im Push
select pg_temp.assert_eq(
  (select count(*)::int from public.notifications where payload::text like '%Erika%'), 0, 'kein Kundenname im Payload');

-- Empfänger: S und Admin, nicht T (Auslöser)
select pg_temp.assert_eq(
  (select array_agg(r.id order by r.endpoint)::text from public.notifications n,
     lateral public.notification_recipients(n) r where n.event = 'booking_new' and n.ref_id = :'b1'),
  array[:'sub_admin'::uuid, :'sub_staff'::uuid]::text, 'Empfänger booking_new');

-- S bestellt Umbuchungen ab → bekommt sie nicht mehr
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select public.set_push_events('https://push.example.com/staff', array['booking_new', 'pickup_soon', 'unbekannt']) \gset
reset role;
select pg_temp.assert_eq(
  (select events from public.push_subscriptions where id = :'sub_staff'),
  array['booking_new', 'pickup_soon'], 'unbekannte Ereignisse verworfen');
select pg_temp.assert_eq(
  (select count(*)::int from public.notifications n, lateral public.notification_recipients(n) r
   where n.event = 'booking_changed' and n.ref_id = :'b1' and r.id = :'sub_staff'), 0, 'abbestellt');

-- Zeitplan: Abholung 27.10.2030 14:00 MEZ (nach der Zeitumstellung), Prüfung 13:15 → in 45 min
select public.enqueue_due_notifications('2030-10-27T13:15:00+01:00') \gset
select public.enqueue_due_notifications('2030-10-27T13:20:00+01:00') \gset
select pg_temp.assert_eq(pg_temp.n('pickup_soon', :'b1'), 1, 'pickup_soon genau einmal');
select pg_temp.assert_eq(
  (select payload ->> 'title' from public.notifications where event = 'pickup_soon' and ref_id = :'b1'),
  'Abholung 14:00: M-PN 101', 'Titel pickup_soon (MEZ)');
select pg_temp.assert_eq(
  (select payload ->> 'body' from public.notifications where event = 'pickup_soon' and ref_id = :'b1'),
  'in 45 min · Außen ohne Plane · noch nicht angekommen', 'Text pickup_soon');
-- Zu früh: nichts
select public.enqueue_due_notifications('2030-10-27T11:00:00+01:00') \gset
select pg_temp.assert_eq(pg_temp.n('pickup_soon', :'b1'), 1, 'zu früh keine weitere Meldung');

-- Ankunft bald (MESZ vor der Umstellung)
select public.enqueue_due_notifications('2030-10-25T09:30:00+02:00') \gset
select pg_temp.assert_eq(pg_temp.n('arrival_soon', :'b1'), 1, 'arrival_soon');
select pg_temp.assert_eq(
  (select payload ->> 'title' from public.notifications where event = 'arrival_soon' and ref_id = :'b1'),
  'Ankunft 10:00: M-PN 101', 'Titel arrival_soon (MESZ)');

-- Umbuchung nach der Erinnerung → neue Erinnerung für die neue Abholzeit
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
select public.upsert_booking('{"external_ref": "PN01", "end_at": "2030-10-27T15:00:00+01:00"}'::jsonb, 'test') \gset
reset role;
select public.enqueue_due_notifications('2030-10-27T14:30:00+01:00') \gset
select pg_temp.assert_eq(pg_temp.n('pickup_soon', :'b1'), 2, 'neue Erinnerung nach Umbuchung');

-- Ereignis ausgeschaltet → keine Einträge
update public.settings set value = jsonb_set(value, '{events,arrival_soon,enabled}', 'false') where key = 'notifications';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
select (public.upsert_booking('{
  "external_ref": "PN02", "customer_name": "Max Muster", "plate": "M-PN 102",
  "start_at": "2030-11-02T10:00:00+01:00", "end_at": "2030-11-05T12:00:00+01:00",
  "parking_type": "outdoor_cover", "return_mode": "self"
}'::jsonb, 'test') ->> 'id') as b2 \gset
reset role;
select public.enqueue_due_notifications('2030-11-02T09:30:00+01:00') \gset
select pg_temp.assert_eq(pg_temp.n('arrival_soon', :'b2'), 0, 'ausgeschaltet');
update public.settings set value = jsonb_set(value, '{events,arrival_soon,enabled}', 'true') where key = 'notifications';

-- Storno → booking_changed (Storno)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
select public.upsert_booking('{"external_ref": "PN02", "cancelled": true}'::jsonb, 'test') \gset
reset role;
select pg_temp.assert_eq(
  (select payload ->> 'title' from public.notifications where dedupe_key = 'booking_cancelled:' || :'b2'),
  'Storno M-PN 102', 'Storno gemeldet');

-- Demo-Daten lösen nichts aus
begin;
select set_config('app.change_source', 'demo', true) \gset
select pg_temp.assert_eq(
  public.enqueue_notification('booking_new', 'booking', gen_random_uuid(), 'demo-test', 't', 'b'), null::uuid, 'Demo unterdrückt');
commit;

-- Fahrzeug bereit
update public.bookings set status = 'ready' where id = :'b1';
select pg_temp.assert_eq(pg_temp.n('booking_ready', :'b1'), 1, 'booking_ready');

-- Prüfliste: Import mit needs_review → nur an Admins
insert into public.booking_imports (source, external_ref, mail_type, raw_text, status)
values ('parkos', 'XYZ1', 'change', 'Umbuchung', 'needs_review') returning id as imp \gset
select pg_temp.assert_eq(
  (select payload ->> 'title' from public.notifications where event = 'booking_review' and ref_id = :'imp'),
  'Parkos-Mail prüfen: #XYZ1', 'booking_review Titel');
select pg_temp.assert_eq(
  (select array_agg(r.id)::text from public.notifications n,
     lateral public.notification_recipients(n) r where n.event = 'booking_review' and n.ref_id = :'imp'),
  array[:'sub_admin'::uuid]::text, 'booking_review nur Admin');

-- Shuttle an den eingeteilten Fahrer
insert into public.transport_jobs (id, type, direction, scheduled_at, driver_id, status)
values ('00000000-0000-0000-0000-00000000f001', 'premium_on_demand', 'to_airport', '2030-11-10T08:00:00+01:00',
        '00000000-0000-0000-0000-0000000000f3', 'assigned');
insert into public.transport_passengers (transport_job_id, booking_id, persons, manual)
values ('00000000-0000-0000-0000-00000000f001', :'b1', 3, true);
select public.enqueue_due_notifications('2030-11-10T07:50:00+01:00') \gset
select pg_temp.assert_eq(
  (select payload ->> 'title' || ' / ' || (payload ->> 'body') from public.notifications
   where event = 'shuttle_due' and ref_id = '00000000-0000-0000-0000-00000000f001'),
  'Shuttle 08:00 zum Flughafen / 1 Buchung · 3 Personen', 'shuttle_due Text');
select pg_temp.assert_eq(
  (select array_agg(r.id)::text from public.notifications n,
     lateral public.notification_recipients(n) r where n.event = 'shuttle_due' and n.ref_id = '00000000-0000-0000-0000-00000000f001'),
  array[:'sub_other'::uuid]::text, 'shuttle_due nur Fahrer');

-- Zustellung: claim → finish; 410 schaltet das Abo ab
update public.notifications set status = 'sent'
where status = 'pending' and not (event = 'booking_new' and ref_id = :'b1');
set role service_role;
select public.claim_push_batch(10) as batch \gset
reset role;
select pg_temp.assert_eq(jsonb_array_length(:'batch'::jsonb), 1, 'ein Eintrag im Batch');
select pg_temp.assert_eq(
  (select status from public.notifications where event = 'booking_new' and ref_id = :'b1'), 'sending', 'Status sending');
set role service_role;
select public.finish_push(
  (select id from public.notifications where event = 'booking_new' and ref_id = :'b1'),
  jsonb_build_array(
    jsonb_build_object('subscription_id', :'sub_admin', 'ok', true),
    jsonb_build_object('subscription_id', :'sub_staff', 'ok', false, 'gone', true, 'error', 'HTTP 410')
  )) \gset
reset role;
select pg_temp.assert_eq(
  (select status || '/' || sent_count from public.notifications where event = 'booking_new' and ref_id = :'b1'),
  'sent/1', 'gesendet');
select pg_temp.assert_eq((select active from public.push_subscriptions where id = :'sub_staff'), false, '410 deaktiviert');
select pg_temp.assert_eq((select active from public.push_subscriptions where id = :'sub_admin'), true, 'Admin aktiv');

-- Ohne Empfänger → skipped
update public.notifications set status = 'sent' where status = 'pending';
update public.notifications set status = 'pending', attempts = 0 where event = 'booking_changed' and ref_id = :'b1';
update public.push_subscriptions set active = false;
set role service_role;
select public.claim_push_batch(10) as batch2 \gset
reset role;
select pg_temp.assert_eq(
  (select string_agg(distinct status, ',') from public.notifications where event = 'booking_changed' and ref_id = :'b1'),
  'skipped', 'ohne Empfänger übersprungen');

-- Testbenachrichtigung nur an das eigene, aktive Gerät
update public.push_subscriptions set active = true where id = :'sub_other';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
select public.send_test_push('https://push.example.com/other') as test_id \gset
reset role;
select pg_temp.assert_eq(
  (select array_agg(r.id)::text from public.notifications n,
     lateral public.notification_recipients(n) r where n.id = :'test_id'),
  array[:'sub_other'::uuid]::text, 'Test nur an eigenes Gerät');

-- Nicht über die API aufrufbar
select pg_temp.assert_eq(has_function_privilege('authenticated', 'public.claim_push_batch(integer)', 'execute'), false, 'claim gesperrt');
select pg_temp.assert_eq(has_function_privilege('authenticated', 'public.enqueue_notification(text,text,uuid,text,text,text,text,uuid,uuid)', 'execute'), false, 'enqueue gesperrt');

\o
\echo '  ✓ 95_notifications'
