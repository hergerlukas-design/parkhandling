-- =============================================================================
-- Demo-Daten Phase 1: 40 fiktive Buchungen über die nächsten 14 Tage (relativ zu heute)
-- Wiederholbar: vorhandene Demo-Buchungen (source = 'demo') werden vorher entfernt.
-- Nur Testdaten – Namen, Kennzeichen und Adressen sind erfunden.
--   psql "$DATABASE_URL" -f supabase/demo.sql
--
-- Belegung:
--   R1–R5  je 3 Fahrzeuge in korrekter Reihenfolge (früheste Abholung unten)
--   R6     bewusst falsch sortiert: E2 wird VOR E1 abgeholt → Umsetz-Konflikt
--   R7–R8  frei
--   A1/A2  10 Fahrzeuge mit Plane, B1/B2 8 Fahrzeuge ohne Plane
--   5 Ankünfte in den nächsten Tagen (noch ohne Platz)
-- =============================================================================

delete from public.bookings where source = 'demo';

do $$
declare
  firsts text[] := array['Anna','Ben','Clara','David','Emma','Felix','Greta','Hannes','Ida','Jonas',
                         'Klara','Lukas','Mia','Noah','Olga','Paul','Rosa','Sven','Tilda','Uwe'];
  lasts text[] := array['Albrecht','Brandl','Czerny','Danner','Eberl','Fuchs','Gruber','Huber','Imhof',
                        'Jäger','Kraus','Lindner','Moser','Neumaier','Obermaier','Pichler','Riedl',
                        'Steiner','Thaler','Unger'];
  -- Modell | Antrieb
  models text[] := array['VW Golf|combustion','BMW 320d|combustion','Tesla Model 3|electric','Audi A4|combustion',
                         'Mercedes C 200|combustion','Hyundai Ioniq 5|electric','Skoda Octavia|combustion',
                         'VW ID.4|electric','BMW iX3|electric','Toyota Corolla|hybrid','Porsche Taycan|electric',
                         'Opel Astra|combustion','Mini Cooper|combustion','Volvo XC60|hybrid','Ford Kuga|combustion'];
  letters text[] := array['AB','KL','MP','RS','TW','EV','HN','GL','BR','DS','FX','LU','NO','PQ','ZT'];
  today date := (now() at time zone 'Europe/Berlin')::date;
  i integer;
  b uuid;
  model text;
  fuel text;
  ptype text;
  loc_code text;
  start_day integer;
  end_day integer;
  end_hour integer;
  col integer;
  lvl integer;
  extras text[];
  stored boolean;
  t timestamptz;
begin
  perform set_config('app.change_source', 'demo', true);

  for i in 1..40 loop
    model := split_part(models[1 + (i * 7) % array_length(models, 1)], '|', 1);
    fuel := split_part(models[1 + (i * 7) % array_length(models, 1)], '|', 2);
    end_hour := 8 + (i * 5) % 13;
    stored := true;
    loc_code := null;

    if i <= 15 then
      -- Halle R1–R5 korrekt: E1 früheste, E3 späteste Abholung
      ptype := 'indoor';
      col := (i - 1) / 3 + 1;
      lvl := 3 - (i - 1) % 3;
      end_day := (col - 1) + (lvl - 1) * 3;
      loc_code := format('R%s-E%s', col, lvl);
    elsif i <= 17 then
      -- Halle R6 falsch sortiert: E1 holt am Tag 9 ab, E2 schon am Tag 5
      ptype := 'indoor';
      lvl := i - 15;
      end_day := case lvl when 1 then 9 else 5 end;
      loc_code := format('R6-E%s', lvl);
    elsif i <= 27 then
      ptype := 'outdoor_cover';
      end_day := (i * 3) % 14;
      loc_code := format('A%s-%s', 1 + (i % 2), lpad((i - 15)::text, 2, '0'));
    elsif i <= 35 then
      ptype := 'outdoor';
      end_day := (i * 5) % 14;
      loc_code := format('B%s-%s', 1 + (i % 2), lpad((i - 25)::text, 2, '0'));
    else
      -- künftige Ankünfte
      ptype := (array['indoor', 'outdoor_cover', 'outdoor'])[1 + i % 3];
      stored := false;
      end_day := 7 + i % 7;
    end if;

    start_day := case when stored then -(2 + i % 6) else i - 36 end;

    insert into public.bookings (
      source, external_ref, received_at, customer_name, company, customer_email, customer_phone,
      plate, vehicle_model, fuel_type, persons, start_at, end_at, parking_type, return_mode,
      price_total, payment_status, notes
    ) values (
      'demo',
      format('DEMO-%s', lpad(i::text, 4, '0')),
      ((today + start_day - 10 - i % 9)::timestamp + interval '10 hours') at time zone 'Europe/Berlin',
      firsts[1 + (i - 1) % 20] || ' ' || lasts[1 + (i * 3) % 20],
      case when i % 8 = 0 then 'Muster Logistik GmbH' end,
      lower(firsts[1 + (i - 1) % 20]) || '.' || lower(replace(lasts[1 + (i * 3) % 20], 'ä', 'ae')) || '@example.com',
      format('+49 151 %s', lpad((1000000 + i * 7919)::text, 7, '0')),
      format('M-%s %s', letters[1 + i % array_length(letters, 1)], 1000 + (i * 137) % 9000),
      model,
      fuel,
      1 + i % 4,
      ((today + start_day)::timestamp + make_interval(hours => 5 + i % 6)) at time zone 'Europe/Berlin',
      ((today + end_day)::timestamp + make_interval(hours => end_hour)) at time zone 'Europe/Berlin',
      ptype,
      case when i % 9 = 0 then 'pickup_delivery' when i % 6 = 0 then 'vallet' else 'shuttle' end,
      case when i % 3 = 0 then null else 59 + i * 4.5 end,
      case when i % 7 = 0 then 'partial' when i % 2 = 0 then 'paid' else 'open' end,
      case when i % 10 = 0 then 'Kindersitz im Kofferraum lassen' end
    )
    returning id into b;

    -- Zusatzleistungen (Grundreinigung kommt automatisch)
    extras := '{}';
    if fuel = 'electric' then extras := extras || 'LADEN'::text; end if;
    if fuel <> 'electric' and i % 7 = 0 then extras := extras || 'TANKEN'::text; end if;
    if i % 3 = 0 then extras := extras || 'AUF_INNEN'::text; end if;
    if i % 4 = 0 then extras := extras || 'AUF_AUSSEN'::text; end if;
    if i % 11 = 0 then extras := extras || 'POLITUR'::text; end if;
    insert into public.booking_services (booking_id, service_id, price_at_booking)
    select b, s.id, s.price from public.services s where s.code = any (extras);
    if i % 13 = 0 then
      insert into public.booking_services (booking_id, service_id, description)
      select b, s.id, 'Dachbox abmontieren und einlagern' from public.services s where s.code = 'ZUSATZ';
    end if;

    if stored then
      t := ((today + start_day)::timestamp + make_interval(hours => 6 + i % 6)) at time zone 'Europe/Berlin';
      update public.bookings set status = 'stored' where id = b;
      insert into public.vehicle_movements (booking_id, to_location_id, moved_at, reason)
      select b, id, t, 'Einlagern (Demo)' from public.locations where code = loc_code;
      update public.keys set booking_id = b where key_code = format('K-%s', lpad(i::text, 3, '0'));

      -- Teil der Fahrzeuge ist fertig aufbereitet → Status „bereit“
      if i % 4 = 0 then
        update public.tasks set status = 'done', done_at = t + interval '3 hours',
          checklist = (select coalesce(jsonb_agg(c || '{"done": true}'), '[]') from jsonb_array_elements(checklist) c)
        where booking_id = b;
      elsif i % 5 = 1 then
        update public.tasks set status = 'in_progress' where booking_id = b and type = 'service'
          and id = (select id from public.tasks where booking_id = b and type = 'service' order by created_at limit 1);
      end if;
    end if;
  end loop;
end;
$$;

-- Ortsstatus nach dem Entfernen alter Demo-Buchungen neu berechnen
do $$
declare l uuid;
begin
  for l in select id from public.locations loop
    perform public.refresh_location_status(l);
  end loop;
end;
$$;
