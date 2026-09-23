-- =============================================================================
-- Stammdaten: Bereiche, Stellplätze, Leistungskatalog
-- Idempotent – kann gefahrlos mehrfach ausgeführt werden (auch auf Produktion,
-- z. B. per `psql -f supabase/seed.sql`). Bestehende Einträge bleiben unverändert.
-- Anzahl Regale/Reihen/Plätze an die tatsächliche Anlage anpassen.
-- =============================================================================

-- Leistungskatalog (vorläufig; finaler Katalog und Preise noch offen)
insert into public.services (code, name, category, price, is_default, sort_order) values
  ('GRUND',     'Grundreinigung',         'cleaning', 0.00,  true,  10),
  ('INNEN',     'Innenreinigung',         'cleaning', 39.00, false, 20),
  ('AUSSEN',    'Außenwäsche',            'cleaning', 29.00, false, 30),
  ('KOMPLETT',  'Komplettaufbereitung',   'cleaning', 149.00, false, 40),
  ('LADEN',     'E-Fahrzeug laden',       'charge',   25.00, false, 50),
  ('TANKEN',    'Volltanken (zzgl. Kraftstoff)', 'fuel', 15.00, false, 60),
  ('REIFEN',    'Reifendruck prüfen',     'care',     0.00,  false, 70)
on conflict (code) do nothing;

-- Halle: 12 Regale mit je 1 Spalte und 3 Ebenen (Code R<Regal>-E<Ebene>)
insert into public.locations (code, area, rack, rack_column, level, has_cover, qr_code, sort_order)
select
  format('R%s-E%s', r, e),
  'hall', r, 1, e, true,
  format('PF-LOC:R%s-E%s', r, e),
  r * 10 + e
from generate_series(1, 12) r, generate_series(1, 3) e
on conflict (code) do nothing;

-- Außen A: mit Abdeckplane, Reihen A1–A2 à 12 Plätze (Code A<Reihe>-<Nr>)
insert into public.locations (code, area, "row", number, has_cover, qr_code, sort_order)
select
  format('A%s-%s', rw, lpad(n::text, 2, '0')),
  'outdoor_a', format('A%s', rw), n, true,
  format('PF-LOC:A%s-%s', rw, lpad(n::text, 2, '0')),
  1000 + rw * 100 + n
from generate_series(1, 2) rw, generate_series(1, 12) n
on conflict (code) do nothing;

-- Außen B: ohne Abdeckplane, Reihen B1–B3 à 15 Plätze
insert into public.locations (code, area, "row", number, has_cover, qr_code, sort_order)
select
  format('B%s-%s', rw, lpad(n::text, 2, '0')),
  'outdoor_b', format('B%s', rw), n, false,
  format('PF-LOC:B%s-%s', rw, lpad(n::text, 2, '0')),
  2000 + rw * 100 + n
from generate_series(1, 3) rw, generate_series(1, 15) n
on conflict (code) do nothing;

-- Arbeits-, Puffer- und Transitorte
insert into public.locations (code, name, area, capacity, qr_code, sort_order) values
  ('W-AUF', 'Aufbereitung',       'work',    4,   'PF-LOC:W-AUF', 3000),
  ('W-LAD', 'Ladeplatz',          'work',    2,   'PF-LOC:W-LAD', 3010),
  ('W-UEB', 'Übergabe',           'work',    6,   'PF-LOC:W-UEB', 3020),
  ('P-01',  'Puffer 1',           'buffer',  1,   'PF-LOC:P-01',  3100),
  ('P-02',  'Puffer 2',           'buffer',  1,   'PF-LOC:P-02',  3110),
  ('P-03',  'Puffer 3',           'buffer',  1,   'PF-LOC:P-03',  3120),
  ('P-04',  'Puffer 4',           'buffer',  1,   'PF-LOC:P-04',  3130),
  ('T-VAL', 'Vallet unterwegs',   'transit', 50,  'PF-LOC:T-VAL', 3200)
on conflict (code) do nothing;
