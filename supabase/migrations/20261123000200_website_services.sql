-- =============================================================================
-- Leistungen wie auf der Website (www.parkhandling.de/buchen, Stand 23.11.2026) (0.35.0)
--  * Grundreinigung heißt „Reinigung innen“ (Website: „Reinigung innen inkl. Scheiben“,
--    Economy +: „Innenreinigung“); Code GRUND bleibt, Economy weiter ohne
--  * Neue Leistungen für Premium: „Reinigung außen“ (AUSSEN), „CarCover Satin“ (CARCOVER),
--    „Check Luftdruck & Flüssigkeiten“ (CHECK). Premium bucht diese drei statt einer
--    allgemeinen „Servicearbeiten“-Aufgabe; neu angelegte Buchungen bekommen je eine Aufgabe
--  * Tariftexte (enthaltene Leistungen, Shuttle) wörtlich wie auf der Website
-- [ANNAHME] Checklisten der neuen Leistungen; in der App unter Leistungen anpassbar.
-- Bestehende Buchungen bleiben unverändert. Texte/Werte nur ersetzen, wenn sie noch dem
-- bisherigen Stand entsprechen (per Admin geänderte Werte bleiben).
-- =============================================================================

update public.services
set name = 'Reinigung innen'
where code = 'GRUND' and name = 'Grundreinigung';

insert into public.services (code, name, category, price, is_default, sort_order, steps) values
  ('AUSSEN',   'Reinigung außen',                  'cleaning', null, false, 15,
   '["Außenwäsche", "Scheiben außen", "Trocknen"]'),
  ('CARCOVER', 'CarCover Satin',                   'service',  null, false, 65,
   '["CarCover Satin aufgelegt", "Vor der Rückgabe abgenommen und verstaut"]'),
  ('CHECK',    'Check Luftdruck & Flüssigkeiten',  'service',  null, false, 66,
   '["Luftdruck geprüft und korrigiert", "Motoröl geprüft", "Kühlmittel geprüft", "Scheibenwaschwasser aufgefüllt"]')
on conflict (code) do nothing;

update public.booking_tariffs
set included_services = '[
      {"code": "AUSSEN", "description": "Tarif Premium: Reinigung außen inkl. Scheiben"},
      {"code": "CARCOVER", "description": "Tarif Premium"},
      {"code": "CHECK", "description": "Tarif Premium"}
    ]'::jsonb,
    updated_at = now()
where code = 'premium'
  and included_services = '[{"code": "SERVICE", "description": "Tarif Premium: Luftdruck und Betriebsflüssigkeiten prüfen, CarCover Satin Indoor"}]'::jsonb;

update public.booking_tariffs t
set shuttle_text = v.shuttle_text, included_text = v.included_text, updated_at = now()
from (values
  ('economy', 'Alle 60 Minuten', 'Geräumiger Außenstellplatz, abgesperrtes Gelände, Videoüberwachung, Annahme/Ausgabe & ParkHandling',
   'Direkt (Wartezeit bis 30 Min. zum Terminal)',
   'Privatgelände, Videoüberwachung'),
  ('space', 'Alle 60 Minuten', 'Geräumiger Außenstellplatz, abgesperrtes Gelände, Videoüberwachung, Grob-Reinigung Interieur, Wetterschutzplane Outdoor, Annahme/Ausgabe & ParkHandling',
   'Direkt (Wartezeit bis 30 Min. zum Terminal)',
   'Privatgelände, Videoüberwachung, Full-Body Wetterschutzplane, Innenreinigung Economy'),
  ('business', 'Alle 30 Minuten', 'Innenstellplatz im Park-Regal, doppelt gesicherte Fahrzeughalle, klimatisiert 18 °C, Grob-Reinigung Interieur, Annahme/Ausgabe & ParkHandling',
   'Direkt (bei Vollauslastung alle 30 Min.)',
   'Doppelt gesichertes Gebäude, Kameraüberwachung, klimatisiert, Reinigung innen inkl. Scheiben'),
  ('premium', 'Direkt', 'Innenstellplatz im Park-Regal, doppelt gesicherte Fahrzeughalle, klimatisiert 18 °C, Grundreinigung Interieur, CarCover Satin Indoor, Prüfung Luftdruck und Betriebsflüssigkeiten, Annahme/Ausgabe & ParkHandling',
   'Direkt ohne Wartezeit',
   'Doppelt gesichertes Gebäude, Kameraüberwachung, klimatisiert, Reinigung innen & außen inkl. Scheiben, CarCover Satin, Check Luftdruck & Flüssigkeiten')
) as v (code, old_shuttle, old_included, shuttle_text, included_text)
where t.code = v.code and t.shuttle_text = v.old_shuttle and t.included_text = v.old_included;
