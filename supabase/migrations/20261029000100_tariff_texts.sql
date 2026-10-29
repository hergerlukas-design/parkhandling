-- =============================================================================
-- Tariftexte der Landingpage (Review-Notizen 27.10.2026, landing 0.9.0)
--  * Tarif „Space“ heißt jetzt „Cover“ (Code bleibt space, Links mit ?tarif=space gelten weiter)
--  * Economy und Cover: „Geräumiger Außenstellplatz“ statt Flächenangabe in m²
-- Nur Texte, additiv; per Admin geänderte Texte bleiben unberührt (replace greift nur auf den Ursprungstext)
-- =============================================================================

update public.booking_tariffs
set label = 'Cover', updated_at = now()
where code = 'space' and label = 'Space';

update public.booking_tariffs
set included_text = replace(replace(included_text, 'Außenstellplatz 12 m²', 'Geräumiger Außenstellplatz'),
                            'Außenstellplatz 15 m²', 'Geräumiger Außenstellplatz'),
    updated_at = now()
where code in ('economy', 'space')
  and (included_text like '%Außenstellplatz 12 m²%' or included_text like '%Außenstellplatz 15 m²%');
