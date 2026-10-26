# Nachtrag zur Arbeitsanweisung – Stand 26.10.2026

Ergänzt `PARK_AND_FLY_Arbeitsanweisung.md` und die Nachträge vom 08.10., 22.10. und 25.10.2026. Bei Widerspruch gilt dieser Nachtrag für die genannten Punkte.

## Abschnitt 3 Datenmodell
- Neue Tabelle `charge_points`: Ladepunkte mit Ladeplatz (`location_id`), Provider, Station-/Connector-ID, eigenem QR-Code `PF-CHG:<Code>`, Kennzeichen „eichrechtskonform“ (`legal_metering`)
- Neue Tabelle `charging_sessions`: Ladevorgänge je Buchung/Aufgabe mit kWh, SoC, Zeiten, Herkunft (`api`/`manual`), Abrechnungswerte
- Neue Tabelle `charging_sync_state`: Token-Cache und Zustand der Schnittstelle (kein Client-Zugriff)
- `settings.charging`: Provider, API an/aus, Abfrageintervall, Zeitfenster für die Zuordnung, Abrechnungsart (`flat`/`per_kwh`), Preis pro kWh, automatischer Abschluss der Aufgabe

## Neuer Abschnitt 4a Ladeschnittstelle (Adapter)
- Ladedaten laufen über eine Adapter-Schicht (`supabase/functions/_shared/kempower.ts`, Provider `kempower` und `manual`). Kein Code außerhalb davon setzt Kempower voraus.
- Zuordnung Ladung ↔ Buchung ausschließlich per Scan des eigenen QR-Aufklebers am Ladepunkt in der Aufgabe „Laden“ (`start_charging`). Der QR-Code auf dem Kempower-Display ist ein Token pro Ladevorgang und wird nicht genutzt.
- Abruf per Polling: Edge Function `charging-sync`, angestoßen per `pg_net` nach dem Scan und per `pg_cron` (gedrosselt auf das Abfrageintervall). Refresh-Token und Aufruf-Secret im Supabase Vault.

## Abschnitt 7 Ansichten
- Aufgabe „Laden“ zeigt Ladestatus live; Fahrzeug-Detail bekommt den Abschnitt „Ladungen“
- Einstellungen bekommen „Laden: Ladepunkte & Abrechnung“ inkl. QR-Druck (`/ladepunkte`)

## Abschnitt 10a Push
- Neues Ereignis `charging_ended` (Standard: Personal)

## Abschnitt 13 Offene Punkte
- Abrechnung pro kWh nur mit eichrechtskonformer Messung und API-Wert; sonst Pauschale über die Leistung „Laden“
