# Nachtrag zur Arbeitsanweisung – Stand 08.10.2026

Dieser Nachtrag ergänzt `PARK_AND_FLY_Arbeitsanweisung.md` an den genannten Stellen. Bei Widerspruch gilt dieser Nachtrag für die genannten Punkte. Alles andere bleibt gültig.

## Abschnitt 3 Datenmodell
- `bookings`: Keine Änderung am Status-Flow.
- `protocols.mileage`: `numeric(10,1)` statt Ganzzahl (Dezimalkomma in der UI, Punkt in der DB)
- `protocols.fuel_level`: `smallint`, Wertebereich 0–8 (8-Segment-Slider)
- `protocols.soc_percent`: entfällt (zuerst nicht mehr schreiben, danach Spalte entfernen)
- `transport_jobs.type`: Wert `vallet` entfällt
- Leistungsbezeichnung „Vallet“ wird zu „Hol- & Bringservice“ (`return_mode = pickup_delivery`)

## Abschnitt 7 Ansichten
- **Heute** wird zum **Dashboard** mit Datumsauswahl: Heute, Morgen, Wochenansicht, Vor-/Zurück-Navigation
- **Lageplan:** Stellplatz-Label zeigt `bookings.end_at` (Abholdatum). Die Farblogik nach Abholdatum bleibt unverändert.
- **Shuttle/Vallet** heißt **Shuttle/Hol- & Bringservice**

## Abschnitt 9 Protokolle
- Schadenscard mit eigenem Speichern-Button pro Schadenseintrag
- Tankstand als Slider mit 8 Segmenten
- Kilometerstand mit einer Nachkommastelle

## Abschnitt 11.1 Bild-Pipeline
Für `media.owner_type = damage`:
- Längste Kante max. 2400 px
- WebP, Qualität ~0,85, Ziel ~500 KB

Alle übrigen Fotos bleiben bei 1600 px / 0,75 / ~250 KB. Thumbnails bleiben bei 320 px.

## Abschnitt 12 Umsetzungsreihenfolge
- Schritt 9 heißt „Shuttle/Hol- & Bringservice-Planung“
- Nach Umsetzung: Version erhöhen (minor), CHANGELOG ergänzen, Build prüfen
