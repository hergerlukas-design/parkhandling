-- Laden erfassen: Scan am Ladepunkt, manueller Modus, Abruf über die API, Abrechnung
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

-- Erwartet einen Fehler, dessen Text das Muster enthält
create or replace function pg_temp.assert_fails(p_sql text, p_like text, msg text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FEHLER: % (kein Fehler ausgelöst)', msg;
exception when others then
  if sqlerrm like 'FEHLER:%' then raise; end if;
  if sqlerrm not like p_like then
    raise exception 'FEHLER: % (falscher Fehler: %)', msg, sqlerrm;
  end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e7', 'laden-admin@example.com', '{"name": "Admin Laden"}'),
  ('00000000-0000-0000-0000-0000000000e8', 'laden@example.com', '{"name": "Mitarbeiter Laden"}'),
  ('00000000-0000-0000-0000-0000000000e9', 'laden-fahrer@example.com', '{"name": "Fahrer Laden"}');
update public.profiles set active = true, role = 'admin' where id = '00000000-0000-0000-0000-0000000000e7';
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000e8';
update public.profiles set active = true, roles = array['driver'] where id = '00000000-0000-0000-0000-0000000000e9';

-- Ladepunkte aus dem Seed
select pg_temp.assert_eq((select count(*)::int from public.charge_points where code in ('LP1', 'LP2')), 2, 'Seed: 2 Ladepunkte');
select pg_temp.assert_eq(
  (select l.code from public.charge_points cp join public.locations l on l.id = cp.location_id where cp.code = 'LP1'),
  'W-LAD1', 'LP1 an Ladeplatz 1');
select pg_temp.assert_eq((select qr_code from public.charge_points where code = 'LP2'), 'PF-CHG:LP2', 'QR-Inhalt');
select pg_temp.assert_eq((public.charge_point_by_scan('pf-chg:lp1')).code, 'LP1', 'Scan klein geschrieben');
select pg_temp.assert_eq((public.charge_point_by_scan('LP2')).code, 'LP2', 'Scan nur Code');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e8';

select public.upsert_booking(jsonb_build_object('external_ref', 'L-1', 'customer_name', 'Laden Eins', 'plate', 'M-LA 1',
  'start_at', now(), 'end_at', now() + interval '3 days', 'parking_type', 'outdoor', 'services', jsonb_build_array('LADEN')), 'ladetest') ->> 'id' as b1 \gset
select public.upsert_booking(jsonb_build_object('external_ref', 'L-2', 'customer_name', 'Laden Zwei', 'plate', 'M-LA 2',
  'start_at', now(), 'end_at', now() + interval '4 days', 'parking_type', 'outdoor', 'services', jsonb_build_array('LADEN')), 'ladetest') ->> 'id' as b2 \gset
select public.upsert_booking(jsonb_build_object('external_ref', 'L-3', 'customer_name', 'Laden Drei', 'plate', 'M-LA 3',
  'start_at', now(), 'end_at', now() + interval '5 days', 'parking_type', 'outdoor', 'services', jsonb_build_array('LADEN')), 'ladetest') ->> 'id' as b3 \gset
select public.move_vehicle(:'b1', 'B1-21', 'Einlagern');
select id as t1 from public.tasks where booking_id = :'b1' and type = 'charge' \gset
select id as t2 from public.tasks where booking_id = :'b2' and type = 'charge' \gset
select id as t3 from public.tasks where booking_id = :'b3' and type = 'charge' \gset
select id as tclean from public.tasks where booking_id = :'b1' and type = 'service' limit 1 \gset

-- Falsche Codes
select pg_temp.assert_fails(format('select public.start_charging(%L, %L)', :'t1', 'https://kempower.io/c/5ca7e9c7-d20a-4e96-9875-9a9ed4cdf4b3?l=de'),
  '%Code vom Display%', 'Display-Code abgelehnt');
select pg_temp.assert_fails(format('select public.start_charging(%L, %L)', :'t1', 'PF-CHG:LP9'), '%kein Ladepunkt%', 'unbekannter Ladepunkt');
select pg_temp.assert_fails(format('select public.start_charging(%L, %L)', :'tclean', 'PF-CHG:LP1'), '%Keine Ladeaufgabe%', 'nur Ladeaufgaben');

-- Manueller Modus (API aus): Sitzung manual, Aufgabe in Arbeit, Hinweis zum Ladeplatz
select public.start_charging(:'t1', 'PF-CHG:LP1') as r1 \gset
select pg_temp.assert_eq((:'r1'::jsonb) ->> 'status', 'manual', 'API aus → manuell');
select pg_temp.assert_eq((:'r1'::jsonb) -> 'location_hint' ->> 'code', 'W-LAD1', 'Hinweis: Fahrzeug nicht am Ladeplatz');
select (:'r1'::jsonb) ->> 'session_id' as s1 \gset
select pg_temp.assert_eq((select status from public.tasks where id = :'t1'), 'in_progress', 'Aufgabe in Arbeit');
select pg_temp.assert_eq((select linked_by_name from public.charging_session_board where id = :'s1'), 'Mitarbeiter Laden', 'verknüpft von');

-- Doppelt: gleiche Aufgabe / belegter Ladepunkt
select pg_temp.assert_fails(format('select public.start_charging(%L, %L)', :'t1', 'LP2'), '%bereits eine Ladung offen%', 'eine offene Ladung je Aufgabe');
select pg_temp.assert_fails(format('select public.start_charging(%L, %L)', :'t2', 'LP1'), '%LP1 ist belegt (M-LA 1)%', 'Ladepunkt belegt');

-- Werte von Hand: Prüfungen, dann beendet
select pg_temp.assert_fails(format('select public.save_manual_charging(%L, 900)', :'s1'), '%zwischen 0 und 500%', 'kWh-Grenze');
select pg_temp.assert_fails(format('select public.save_manual_charging(%L, 10, now(), now() - interval ''1 hour'')', :'s1'), '%vor dem Beginn%', 'Ende vor Beginn');
select public.save_manual_charging(:'s1', 23.4567, now() - interval '2 hours', now(), 20::smallint, 80::smallint);
select pg_temp.assert_eq((select status from public.charging_sessions where id = :'s1'), 'ended', 'manuell beendet');
select pg_temp.assert_eq((select energy_kwh from public.charging_sessions where id = :'s1'), 23.457::numeric, 'kWh gerundet');
select pg_temp.assert_eq((select soc_end from public.charging_sessions where id = :'s1'), 80::smallint, 'SoC Ende');
select pg_temp.assert_eq((select status from public.tasks where id = :'t1'), 'in_progress', 'ohne Automatik bleibt die Aufgabe offen');

-- Pauschale: keine Übernahme pro kWh
select pg_temp.assert_fails(format('select public.apply_charging_price(%L)', :'s1'), '%Pauschale%', 'Pauschale');

-- Reiner Fahrer sieht keine Ladungen
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.assert_eq((select count(*)::int from public.charging_sessions), 0, 'Fahrer sieht keine Ladungen');
select pg_temp.assert_fails(format('select public.start_charging(%L, %L)', :'t2', 'LP2'), '%Kein Zugriff%', 'Fahrer darf nicht laden');

-- Personal darf Einstellungen und Ladepunkte nicht ändern, nur lesen
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e8';
update public.charge_points set legal_metering = true where code = 'LP2';
select pg_temp.assert_eq((select legal_metering from public.charge_points where code = 'LP2'), false, 'Personal ändert keine Ladepunkte');
select pg_temp.assert_fails('select public.request_charging_test()', '%Nur für Admins%', 'Test nur Admin');
select pg_temp.assert_eq((public.charging_status() ->> 'api_enabled')::boolean, false, 'Status lesbar');
select pg_temp.assert_eq(public.charging_status() ? 'access_token', false, 'kein Token im Status');

-- Admin schaltet API, Kempower-Ladepunkt, Abrechnung pro kWh und Automatik ein
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e7';
update public.charge_points set provider = 'kempower', station_id = 'charger1', connector_id = '1' where code = 'LP2';
update public.settings set value = value || '{"api_enabled": true, "provider": "kempower", "auto_complete_task": true, "billing_mode": "per_kwh", "price_per_kwh": 0.49}'::jsonb
  where key = 'charging';
select public.request_charging_test();

-- Abruf über die API: wartet, wird verknüpft, läuft, endet
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e8';
select (public.start_charging(:'t2', 'PF-CHG:LP2') ->> 'session_id') as s2 \gset
select pg_temp.assert_eq((select status from public.charging_sessions where id = :'s2'), 'waiting', 'API → wartet');
select pg_temp.assert_fails(format('select public.charging_apply(%L, %L)', :'s2', '{"tx_id": "TX1"}'), '%permission denied%', 'charging_apply gesperrt');

reset role;
select pg_temp.assert_eq((select jsonb_array_length(public.charging_open_sessions())), 1, 'eine offene API-Sitzung');
select pg_temp.assert_eq((public.charging_open_sessions() -> 0 ->> 'station_id'), 'charger1', 'Station im Abruf');
select pg_temp.assert_eq(public.charging_apply(:'s2', '{"tx_id": "TX1", "state": "charging", "started_at": "2030-01-01T10:00:00Z", "energy_kwh": 5.2, "soc_start": 30, "soc": 41, "power_kw": 110.5}'), 'linked', 'verknüpft');
select pg_temp.assert_eq(public.charging_apply(:'s2', '{"tx_id": "TX9", "state": "charging"}'), 'ignored', 'fremde Transaktion ignoriert');
select pg_temp.assert_eq(public.charging_apply(:'s2', '{"tx_id": "TX1", "state": "charging", "energy_kwh": 12.0, "soc": 55, "power_kw": 80}'), 'updated', 'aktualisiert');
select pg_temp.assert_eq((select max_power_kw from public.charging_sessions where id = :'s2'), 110.5::numeric, 'Spitzenleistung');
select pg_temp.assert_eq((select soc_start from public.charging_sessions where id = :'s2'), 30::smallint, 'SoC Beginn bleibt');

-- Gleiche Transaktion an einer zweiten Buchung → abgelehnt
insert into public.charging_sessions (booking_id, task_id, charge_point_id, provider, status, source)
select :'b3', :'t3', id, 'kempower', 'waiting', 'api' from public.charge_points where code = 'LP1';
select id as s3 from public.charging_sessions where task_id = :'t3' \gset
select pg_temp.assert_eq(public.charging_apply(:'s3', '{"tx_id": "TX1", "state": "charging"}'), 'taken', 'Transaktion schon vergeben');

-- Ladeende: Werte fest, Aufgabe automatisch erledigt, Push
select pg_temp.assert_eq(public.charging_apply(:'s2', '{"tx_id": "TX1", "state": "ended", "ended_at": "2030-01-01T11:00:00Z", "energy_kwh": 23.412, "soc": 80, "end_reason": "EvDisconnected"}'), 'ended', 'beendet');
select pg_temp.assert_eq((select status from public.charging_sessions where id = :'s2'), 'ended', 'Status beendet');
select pg_temp.assert_eq((select power_kw from public.charging_sessions where id = :'s2'), null::numeric, 'keine laufende Leistung');
select pg_temp.assert_eq((select status from public.tasks where id = :'t2'), 'done', 'Aufgabe automatisch erledigt');
select pg_temp.assert_eq(
  (select payload ->> 'body' from public.notifications where event = 'charging_ended' and ref_id = :'s2'),
  'LP2 · 23,4 kWh · 80 %', 'Push-Text');
select pg_temp.assert_eq(
  (select payload ->> 'url' from public.notifications where event = 'charging_ended' and ref_id = :'s2'),
  '/aufgaben?aufgabe=' || :'t2', 'Push öffnet die Aufgabe');
select pg_temp.assert_eq(public.charging_apply(:'s2', '{"tx_id": "TX1", "state": "ended"}'), 'ignored', 'nach Ende keine Änderung');

-- Abrechnung pro kWh: ohne eichrechtskonforme Messung gesperrt, danach übernommen
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e8';
select pg_temp.assert_fails(format('select public.apply_charging_price(%L)', :'s2'), '%eichrechtskonform%', 'ohne Eichrecht gesperrt');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e7';
update public.charge_points set legal_metering = true where code = 'LP2';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e8';
select pg_temp.assert_eq(public.apply_charging_price(:'s2'), 11.47::numeric, 'Betrag 23,412 kWh × 0,49 €');
select pg_temp.assert_eq(
  (select bs.description from public.booking_services bs join public.services sv on sv.id = bs.service_id where bs.booking_id = :'b2' and sv.code = 'LADEN'),
  '23,412 kWh à 0,49 €', 'Beschreibung in der Leistung');
select pg_temp.assert_eq(
  (select bs.price_at_booking from public.booking_services bs join public.services sv on sv.id = bs.service_id where bs.booking_id = :'b2' and sv.code = 'LADEN'),
  11.47::numeric, 'Preis in der Leistung');
select pg_temp.assert_eq((select count(*)::int from public.booking_history where booking_id = :'b2' and source = 'charging'), 1, 'Buchungshistorie');
-- Manuelle Werte nie pro kWh
select pg_temp.assert_fails(format('select public.apply_charging_price(%L)', :'s1'), '%eichrechtskonform%', 'manuell nie pro kWh');

-- Trennen: Sitzung bleibt, Transaktion wird frei
reset role;
select public.charging_apply(:'s3', '{"tx_id": "TX3", "state": "charging"}');
set role authenticated;
select public.cancel_charging(:'s3', 'falsch gescannt');
select pg_temp.assert_eq((select status from public.charging_sessions where id = :'s3'), 'failed', 'getrennt');
select pg_temp.assert_eq((select end_reason from public.charging_sessions where id = :'s3'), 'Getrennt: falsch gescannt (Transaktion TX3)', 'Grund');
select pg_temp.assert_eq((select external_tx_id from public.charging_sessions where id = :'s3'), null::text, 'Transaktion frei');

-- Wartende Sitzung ohne Treffer läuft nach dem Zeitfenster ab; danach von Hand eintragbar
select (public.start_charging(:'t3', 'LP1') ->> 'session_id') as s4 \gset
reset role;
update public.charging_sessions set status = 'waiting', source = 'api', linked_at = now() - interval '20 minutes' where id = :'s4';
select pg_temp.assert_eq(public.charging_expire_waiting(), 1, 'eine Sitzung abgelaufen');
select pg_temp.assert_eq((select status from public.charging_sessions where id = :'s4'), 'failed', 'keine Ladung erkannt');
set role authenticated;
select public.save_manual_charging(:'s4', 8.5);
select pg_temp.assert_eq((select source || '/' || status from public.charging_sessions where id = :'s4'), 'manual/ended', 'nachgetragen');

-- Abruf: Zustand und Rechte
reset role;
select public.charging_sync_finished(false, 'HTTP 401', '[{"station_id": "charger1"}]');
select pg_temp.assert_eq((select last_error from public.charging_sync_state), 'HTTP 401', 'Fehler gemerkt');
select pg_temp.assert_eq((select test_requested_at from public.charging_sync_state), null::timestamptz, 'Testanfrage erledigt');
select public.charging_store_token('jwt-test', now() + interval '8 hours');
select pg_temp.assert_eq(public.charging_sync_config() ->> 'access_token', 'jwt-test', 'Token-Cache');
select public.charging_store_token('jwt-alt', now() + interval '1 minute');
select pg_temp.assert_eq(public.charging_sync_config() ->> 'access_token', null::text, 'bald ablaufendes Token nicht nutzen');
select pg_temp.assert_eq(has_function_privilege('authenticated', 'public.charging_sync_config()', 'execute'), false, 'Konfiguration gesperrt');
select pg_temp.assert_eq(has_table_privilege('authenticated', 'public.charging_sync_state', 'select'), false, 'Token-Tabelle gesperrt');

\o
\echo '  ✓ 97_charging'
