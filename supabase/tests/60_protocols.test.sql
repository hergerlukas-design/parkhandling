-- Protokolle: Entwurf → final, Schutz finaler Protokolle, ein Protokoll je Art
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'protokoll@example.com');
update public.profiles set active = true where id = '00000000-0000-0000-0000-0000000000e1';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';

select public.upsert_booking(jsonb_build_object('external_ref', 'P-1', 'customer_name', 'Protokoll Kunde', 'plate', 'M-PR 1',
  'start_at', now(), 'end_at', now() + interval '3 days', 'parking_type', 'outdoor'), 'protokolltest') ->> 'id' as bid \gset

insert into public.protocols (booking_id, type, inspector_name, location_text)
values (:'bid', 'intake', 'Mitarbeiter 1', 'Park & Fly Flughafen München') returning id as pid \gset

-- Zweites Annahmeprotokoll für dieselbe Buchung nicht möglich
do $$
begin
  insert into public.protocols (booking_id, type) select booking_id, 'intake' from public.protocols where location_text = 'Park & Fly Flughafen München' limit 1;
  raise exception 'FEHLER: doppeltes Annahmeprotokoll';
exception when unique_violation then null;
end;
$$;

-- Abschließen ohne Kilometerstand scheitert
do $$
begin
  update public.protocols set status = 'final' where location_text = 'Park & Fly Flughafen München';
  raise exception 'FEHLER: final ohne KM-Stand';
exception when raise_exception then
  if sqlerrm not like 'Kilometerstand fehlt%' then raise; end if;
end;
$$;

update public.protocols set mileage = 12345.5, fuel_level = 6, conditions = '{Regen}',
  checklist = '{"floor": true, "aid_kit": true}', damages = '[{"pos": "Tür vorne links", "type": "Kratzer", "int": "Mittel"}]'
where id = :'pid';
update public.protocols set status = 'final' where id = :'pid';
select pg_temp.assert_eq((select finalized_at is not null from public.protocols where id = :'pid'), true, 'finalized_at gesetzt');

-- Finale Protokolle sind unveränderlich …
do $$
begin
  update public.protocols set mileage = 1 where location_text = 'Park & Fly Flughafen München';
  raise exception 'FEHLER: finales Protokoll geändert';
exception when raise_exception then
  if sqlerrm not like '%abgeschlossen%' then raise; end if;
end;
$$;
-- … aber PDF-Verweis und Versandstatus dürfen nachgetragen werden
insert into public.media (booking_id, owner_type, owner_id, kind, bucket, path, slot, uploaded_at)
values (:'bid', 'protocol', :'pid', 'pdf', 'media', 'p/1.pdf', 'pdf', now()) returning id as mid \gset
update public.protocols set pdf_media_id = :'mid', mail_status = 'not_configured' where id = :'pid';
select pg_temp.assert_eq((select mail_status from public.protocols where id = :'pid'), 'not_configured', 'Versandstatus nachgetragen');

-- Vallet wird beim Schreiben (auch von Tablets < 0.14.0) auf Hol- & Bringservice umgeschrieben
update public.bookings set return_mode = 'vallet' where id = :'bid';
select pg_temp.assert_eq((select return_mode from public.bookings where id = :'bid'), 'pickup_delivery', 'vallet → pickup_delivery');

-- Tankstand nur 0–8, Ladestand nur 1–100 %, Kilometerstand mit einer Nachkommastelle
do $$
begin
  insert into public.protocols (booking_id, type, fuel_level) select booking_id, 'handover', 9 from public.protocols where location_text = 'Park & Fly Flughafen München' limit 1;
  raise exception 'FEHLER: fuel_level 9 akzeptiert';
exception when check_violation then null;
end;
$$;
do $$
begin
  insert into public.protocols (booking_id, type, charge_level) select booking_id, 'handover', 101 from public.protocols where location_text = 'Park & Fly Flughafen München' limit 1;
  raise exception 'FEHLER: charge_level 101 akzeptiert';
exception when check_violation then null;
end;
$$;
select pg_temp.assert_eq((select mileage from public.protocols where id = :'pid'), 12345.5::numeric, 'Kilometerstand mit Dezimalstelle');

reset role;
reset request.jwt.claim.sub;
\o
\echo '  ✓ 60_protocols'
