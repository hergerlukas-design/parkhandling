-- Landingpage-Anfragen: Rechte (kein Browser-Schreibzugriff), Prüfungen, Rate-Limit
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

-- Edge Function (service_role) speichert eine Anfrage mit UTM-Werten
set role service_role;
insert into public.inquiries (arrival_date, pickup_date, parking_type, plate, first_name, last_name, email,
  services, utm_source, utm_campaign, consent_privacy_at)
values (current_date + 2, current_date + 9, 'indoor', 'M-TE 123', 'Test', 'Person', 'test@example.com',
  '{shuttle,detailing}', 'google', 'herbst', now());
select pg_temp.assert_eq((select status from public.inquiries where email = 'test@example.com'), 'new', 'Status new');

-- Abholung muss nach Anreise liegen
do $$
begin
  insert into public.inquiries (arrival_date, pickup_date, parking_type, plate, first_name, last_name, email, consent_privacy_at)
  values (current_date + 5, current_date + 5, 'any', 'X', 'A', 'B', 'a@example.com', now());
  raise exception 'FEHLER: Abholung = Anreise akzeptiert';
exception when check_violation then null;
end;
$$;

-- Unbekannte Leistung wird abgelehnt
do $$
begin
  insert into public.inquiries (arrival_date, pickup_date, parking_type, plate, first_name, last_name, email, services, consent_privacy_at)
  values (current_date + 1, current_date + 5, 'any', 'X', 'A', 'B', 'a@example.com', '{valet}', now());
  raise exception 'FEHLER: unbekannte Leistung akzeptiert';
exception when check_violation then null;
end;
$$;

-- Rate-Limit: 5 erlaubt, der 6. nicht; andere IP unabhängig
select pg_temp.assert_eq(
  (select bool_and(public.inquiry_rate_check('ip-a')) from generate_series(1, 5)), true, '5 Versuche erlaubt');
select pg_temp.assert_eq(public.inquiry_rate_check('ip-a'), false, '6. Versuch gesperrt');
select pg_temp.assert_eq(public.inquiry_rate_check('ip-b'), true, 'andere IP frei');
-- Nach Ablauf des Fensters wieder frei
update public.inquiry_rate_hits set created_at = now() - interval '61 minutes' where ip_hash = 'ip-a';
select pg_temp.assert_eq(public.inquiry_rate_check('ip-a'), true, 'nach einer Stunde wieder frei');
reset role;

-- Anonym (Browser): weder lesen noch schreiben noch Rate-Limit aufrufen
set role anon;
do $$
begin
  insert into public.inquiries (arrival_date, pickup_date, parking_type, plate, first_name, last_name, email, consent_privacy_at)
  values (current_date + 1, current_date + 5, 'any', 'X', 'A', 'B', 'a@example.com', now());
  raise exception 'FEHLER: anon darf schreiben';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  perform count(*) from public.inquiries;
  raise exception 'FEHLER: anon darf lesen';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  perform public.inquiry_rate_check('ip-x');
  raise exception 'FEHLER: anon darf Rate-Limit aufrufen';
exception when insufficient_privilege then null;
end;
$$;
reset role;

-- Angemeldet, aber nicht freigeschaltet: sieht nichts, darf nicht anlegen
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'inaktiv@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'personal@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000f2';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.assert_eq((select count(*) from public.inquiries), 0::bigint, 'inaktives Konto sieht keine Anfragen');
do $$
begin
  insert into public.inquiries (arrival_date, pickup_date, parking_type, plate, first_name, last_name, email, consent_privacy_at)
  values (current_date + 1, current_date + 5, 'any', 'X', 'A', 'B', 'a@example.com', now());
  raise exception 'FEHLER: authenticated darf anlegen';
exception when insufficient_privilege then null;
end;
$$;

-- Personal liest und setzt den Status
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.assert_eq((select count(*) from public.inquiries), 1::bigint, 'Personal sieht Anfrage');
select pg_temp.assert_eq((select utm_source from public.inquiries), 'google', 'UTM gespeichert');
update public.inquiries set status = 'contacted';
select pg_temp.assert_eq((select status from public.inquiries), 'contacted', 'Status geändert');
do $$
begin
  delete from public.inquiries;
  raise exception 'FEHLER: Personal darf löschen';
exception when insufficient_privilege then null;
end;
$$;
reset role;

\o
\echo '  ✓ 70_inquiries'
