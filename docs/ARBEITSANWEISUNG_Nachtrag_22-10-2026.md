# Nachtrag zur Arbeitsanweisung – Stand 22.10.2026

Ergänzt `PARK_AND_FLY_Arbeitsanweisung.md` und den Nachtrag vom 08.10.2026. Bei Widerspruch gilt dieser Nachtrag für die genannten Punkte.

## Abschnitt 3 Datenmodell
- `bookings` neu (additiv): `persons`, `flight_out`, `flight_return`, `return_flight_at`, `customer_language`, `transfer_note`, `portal_payout`, `import_flags`, `plate_search` (generiert, indiziert)
- `bookings.end_at` = geplante Abholung am Platz. Bei Portalbuchungen berechnet aus `return_flight_at + return_buffer_minutes`.
- Neue Tabelle `booking_imports` (Rohtext und Parse-Ergebnis jedes Imports, nur Text)

## Abschnitt 4 Buchungsschnittstelle
- Erstes Portal: **Parkos**, Kanal Bestätigungsmail an `fly@parkhandling.com`
- Adapter `ParkosEmailAdapter`, `source = 'parkos'`
- Produktzuordnung Parkform → `parking_type`/`return_mode` über `settings.parkos_product_map`
- Prototyp: Mail manuell einfügen bzw. `.eml` hochladen. Automatischer Eingang über Edge Function `booking-inbound` nur vorbereitet.
- Änderungs- und Stornomails bis zum Vorliegen von Beispielen nur als `needs_review` ablegen

## Abschnitt 5 Regal-Logik
- Sortierung und Konfliktprüfung nutzen weiterhin `end_at`. Eine Änderung von `return_flight_at` oder des Puffers löst die Regalprüfung neu aus.

## Abschnitt 13 Offene Punkte
- „Buchungsportal und Art der Schnittstelle": teilweise geklärt (Parkos per Mail). API und weitere Portale offen.
