# Nachtrag zur Arbeitsanweisung – Stand 25.10.2026

Dieser Nachtrag ergänzt `PARK_AND_FLY_Arbeitsanweisung.md` und die Nachträge vom 08.10. und 22.10.2026. Bei Widerspruch gilt dieser Nachtrag für die genannten Punkte.

## Abschnitt 3 Datenmodell
- Neue Tabelle `push_subscriptions`: Web-Push-Abos pro Gerät, mit abonnierten Ereignissen
- Neue Tabelle `notifications`: Outbox und Protokoll aller Benachrichtigungen, Dedupe über `dedupe_key`
- `settings.notifications`: Ereignisse an/aus, Rollen pro Ereignis, Vorlaufzeiten

## Abschnitt 6 Aktualisierungs-Flow
- Der Service Worker bekommt Push- und Click-Handler. Der Update-Flow (`registerType: 'prompt'`, Zurückhalten bei offenem Protokoll) bleibt unverändert.
- App-Updates werden nur per Banner gemeldet, nicht per Push.

## Abschnitt 7 Ansichten
- Einstellungen bekommen den Bereich „Benachrichtigungen" (Aktivieren, Schalter pro Ereignis, Testbenachrichtigung, Geräteliste für Admin).

## Neuer Abschnitt 10a Push-Benachrichtigungen (Personal)
- Web Push über VAPID. Der Versand läuft über die Edge Function `push-send`. Auslöser sind Postgres-Trigger und `pg_cron`, die Zustellung erfolgt per `pg_net`. Kein Drittanbieter.
- Ereignisse: `booking_new`, `booking_changed`, `booking_review`, `relocate_conflict`, `arrival_soon`, `pickup_soon`, `booking_ready`, `shuttle_due`
- Payload ohne Kundennamen und Kontaktdaten
- Kundenbenachrichtigungen per E-Mail (Abschnitt 10) bleiben davon getrennt.

## Abschnitt 12 Umsetzungsreihenfolge
- Push-Benachrichtigungen als eigener Schritt nach Schritt 9 (umgesetzt in 0.25.0). `shuttle_due` nutzt die Shuttle-Dispo aus 0.24.0.
