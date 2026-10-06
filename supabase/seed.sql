-- =============================================================================
-- Stammdaten laut ANNAHMEN.md: Leistungskatalog, Stellplätze, Arbeitsorte, Schlüsselfächer
-- Idempotent – bestehende Einträge bleiben unverändert. Ausführen mit:
--   psql "$DATABASE_URL" -f supabase/seed.sql
-- Demo-Buchungen separat: supabase/demo.sql
-- =============================================================================

-- Leistungskatalog [ANNAHME]: Preise leer (individuell vereinbart), Teilschritte als Checkliste
insert into public.services (code, name, category, price, is_default, sort_order, steps) values
  ('GRUND',      'Grundreinigung',      'cleaning', null, true,  10, '["Innenraum saugen", "Scheiben innen", "Cockpit abwischen"]'),
  ('AUF_INNEN',  'Aufbereitung innen',  'cleaning', null, false, 20, '["Polster und Teppiche saugen", "Kunststoffe reinigen und pflegen", "Scheiben innen", "Fußmatten"]'),
  ('AUF_AUSSEN', 'Aufbereitung außen',  'cleaning', null, false, 30, '["Vorwäsche", "Handwäsche", "Felgen", "Trocknen", "Scheiben außen"]'),
  ('POLITUR',    'Politur',             'cleaning', null, false, 40, '["Lack prüfen", "Polieren", "Versiegeln"]'),
  ('LADEN',      'Laden',               'charge',   null, false, 50, '["Ladekabel anschließen", "Ziel-Ladestand erreicht", "Kabel verstaut"]'),
  ('TANKEN',     'Tanken',              'fuel',     null, false, 60, '["Tankfahrt", "Beleg abgelegt"]'),
  ('SERVICE',    'Servicearbeiten',     'service',  null, false, 70, '[]'),
  ('ZUSATZ',     'Zusatzleistung',      'other',    null, false, 80, '[]')
on conflict (code) do nothing;

-- Halle [ANNAHME]: 8 Regalspalten × 3 Ebenen (R1–R8, E1 unten – E3 oben)
insert into public.locations (code, area, rack, rack_column, level, has_cover, qr_code, sort_order)
select format('R%s-E%s', r, e), 'hall', r, 1, e, true, format('PF-LOC:R%s-E%s', r, e), r * 10 + e
from generate_series(1, 8) r, generate_series(1, 3) e
on conflict (code) do nothing;

-- Außen A [ANNAHME]: mit Abdeckplane, Reihen A1–A2 à 24 Plätze (Code A1-07)
insert into public.locations (code, area, "row", number, has_cover, qr_code, sort_order)
select format('A%s-%s', rw, lpad(n::text, 2, '0')), 'outdoor_a', format('A%s', rw), n, true,
  format('PF-LOC:A%s-%s', rw, lpad(n::text, 2, '0')), 1000 + rw * 100 + n
from generate_series(1, 2) rw, generate_series(1, 24) n
on conflict (code) do nothing;

-- Außen B [ANNAHME]: ohne Plane, Reihen B1–B2 à 24 Plätze
insert into public.locations (code, area, "row", number, has_cover, qr_code, sort_order)
select format('B%s-%s', rw, lpad(n::text, 2, '0')), 'outdoor_b', format('B%s', rw), n, false,
  format('PF-LOC:B%s-%s', rw, lpad(n::text, 2, '0')), 2000 + rw * 100 + n
from generate_series(1, 2) rw, generate_series(1, 24) n
on conflict (code) do nothing;

-- Arbeitsorte [ANNAHME]
insert into public.locations (code, name, area, capacity, qr_code, sort_order) values
  ('W-AUF1', 'Aufbereitung 1',   'work',    1,  'PF-LOC:W-AUF1', 3000),
  ('W-AUF2', 'Aufbereitung 2',   'work',    1,  'PF-LOC:W-AUF2', 3010),
  ('W-LAD1', 'Ladeplatz 1',      'work',    1,  'PF-LOC:W-LAD1', 3020),
  ('W-LAD2', 'Ladeplatz 2',      'work',    1,  'PF-LOC:W-LAD2', 3030),
  ('W-UEB',  'Übergabezone',     'work',    6,  'PF-LOC:W-UEB',  3040),
  ('P-01',   'Puffer 1',         'buffer',  1,  'PF-LOC:P-01',   3100),
  ('P-02',   'Puffer 2',         'buffer',  1,  'PF-LOC:P-02',   3110),
  ('P-03',   'Puffer 3',         'buffer',  1,  'PF-LOC:P-03',   3120),
  ('T-VAL',  'Vallet unterwegs', 'transit', 50, 'PF-LOC:T-VAL',  3200)
on conflict (code) do nothing;

-- Schlüsselfächer [ANNAHME]: Tresor K-001 bis K-150
insert into public.keys (key_code, storage_place, qr_code)
select format('K-%s', lpad(n::text, 3, '0')), 'Tresor', format('PF-KEY:K-%s', lpad(n::text, 3, '0'))
from generate_series(1, 150) n
on conflict (key_code) do nothing;
