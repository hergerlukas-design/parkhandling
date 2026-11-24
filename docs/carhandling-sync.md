# Buchungen aus dem CarHandling-Backend ins Dashboard

Der Rechner (`parkhandling-rechner.pplx.app`) bucht inzwischen im eigenen Supabase-Projekt der
Organisation CarHandling (`orqkeiveksshijktxepv`, Stripe, Check-in, Tickets). Dieses Backend bleibt führend.
Damit das Team die Buchungen trotzdem in der App sieht (Fahrzeugliste, Aufgaben, Shuttle), schickt das
CarHandling-Projekt jede neue oder geänderte Buchung an unsere Edge Function `booking-sync`.

```
Kunde → Rechner → CarHandling-Backend (Stripe, Check-in, Ticket)      ← führend
                         │  Database Webhook: INSERT / UPDATE / DELETE
                         ▼
          Parkhandling-Supabase: booking-sync → sync_external_booking → Dashboard
```

## Was bei uns passiert

- Neue Buchung → wird angelegt, **Quelle „Rechner (CarHandling-Backend)“**, Kennzeichen **Rechner** in der Fahrzeugliste,
  Aufgaben wie bei jeder Buchung (Tarif-Leistungen wie bei Online-Buchungen; Economy ohne Grundreinigung).
- Änderung (Umbuchung, Zahlung per Stripe) → dieselbe Buchung wird aktualisiert, Änderungen stehen in der Historie.
- Storno (Status `cancelled`/`canceled`, `cancelled_at` gesetzt oder Zeile gelöscht) → Buchung wird storniert.
- Kennung ist die Buchungsnummer (`booking_ref`, sonst `external_ref`, sonst `id`). Wiederholte Aufrufe erzeugen
  **nie ein Doppel**.
- „Bezahlt“ wird nie auf „offen“ zurückgesetzt (z. B. wenn in der App von Hand „Zahlung erhalten“ gedrückt wurde).
- Jeder Vorgang steht im Import-Protokoll (Fahrzeugliste → **Prüfliste**, Kanal „CarHandling-Backend“).
  Datensätze, die nicht übernommen werden können (Pflichtangabe fehlt), erscheinen dort als **Fehlgeschlagen**
  mit Grund; der Webhook bekommt dann HTTP 422.
- Das CarHandling-Backend ist führend: Felder, die es mitschickt, überschreiben bei jeder Änderung die Werte in
  unserer App (auch die Notiz). Ankunft, Stellplatz, Aufgaben und Protokolle bleiben unberührt.

### Verstandene Felder

Beide Schreibweisen gehen: wie unsere Tabelle `bookings` oder wie das Rechner-Formular.

| Bedeutung | Feldnamen (erster vorhandener gilt) | Pflicht |
|---|---|---|
| Buchungsnummer | `booking_ref`, `booking_number`, `external_ref`, `reference`, `id` | ja |
| Name | `customer_name` oder `first_name` + `last_name` | ja |
| Kennzeichen | `plate`, `license_plate` | ja |
| Anreise | `start_at` / `arrival_at` (ISO) oder `arrival_date` + `arrival_time` | ja |
| Abholung | `end_at` / `pickup_at` (ISO) oder `pickup_date` + `pickup_time` | ja |
| Tarif / Parkplatz | `tariff_code` (`economy`, `carcover`/`space`, `business`, `premium`) oder `parking_type` | eins von beiden |
| Kontakt | `customer_email`/`email`, `customer_phone`/`phone`, `company` | |
| Fahrzeug | `vehicle_model`, `fuel_type` (`combustion`, `electric`, `hybrid`) | |
| Personen, Rückgabe | `persons`, `return_mode` (`shuttle`, `self`, `pickup_delivery`/`valet`) | |
| Flüge | `flight_out` + `flight_return` oder `flights` („LH 2020 / LH 2021“) | |
| Betrag, Zahlung | `price_total`/`amount`; `payment_status` (`paid`, `succeeded`, `open`, …) oder `paid_at` | |
| Sonstiges | `notes`, `child_seats`, `luggage`, `language`, `checkin_token` (Ticket-Link in der Notiz) | |

Datum auch als `TT.MM.JJJJ`, Uhrzeit auch `9:00` oder `09:00 Uhr`. Zeiten ohne Zeitzone gelten als Berliner Zeit.

## Einrichtung

### 1. Bei uns (Parkhandling-Supabase) – einmalig

1. Migration `20261124000100_booking_sync.sql` einspielen.
2. Edge Function deployen: `supabase functions deploy booking-sync --no-verify-jwt`
3. Secret setzen: **Edge Functions → Secrets → `BOOKING_SYNC_SECRET`**, ein zufälliger Wert mit mindestens 24
   Zeichen (z. B. `openssl rand -hex 32`). Diesen Wert auf sicherem Weg an CarHandling weitergeben und **nie ins Repo schreiben**.

### 2. Im CarHandling-Projekt (`orqkeiveksshijktxepv`) – Database Webhook

Supabase-Dashboard → **Database → Webhooks → Create a new hook**:

| Einstellung | Wert |
|---|---|
| Name | `parkhandling-dashboard` |
| Table | die Tabelle mit den Buchungen (z. B. `public.bookings`) |
| Events | **Insert**, **Update**, **Delete** |
| Type | HTTP Request, Method **POST** |
| URL | `https://jckewvwnnfwasnxghxsy.supabase.co/functions/v1/booking-sync` (Test: `https://dfukunnkwnckiisdgwnf.supabase.co/functions/v1/booking-sync`) |
| HTTP Headers | `Content-Type: application/json` und `x-sync-secret: <Wert von BOOKING_SYNC_SECRET>` |
| Timeout | 5000 ms |

Der Webhook schickt automatisch `{ type, table, schema, record, old_record }` – mehr braucht es nicht.

Ohne Database Webhook geht es auch aus eigenem Code (z. B. nach erfolgreicher Buchung oder Stripe-Zahlung):

```js
await fetch('https://jckewvwnnfwasnxghxsy.supabase.co/functions/v1/booking-sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sync-secret': Deno.env.get('PARKHANDLING_SYNC_SECRET') },
  body: JSON.stringify({ booking: buchung }), // Felder wie oben
})
```

### 3. Bestehende Buchungen nachholen

Buchungen, die vor dem Einrichten entstanden sind, kommen beim nächsten Update der Zeile an. Für alle auf einmal
im CarHandling-Projekt (SQL-Editor) eine harmlose Änderung auslösen, z. B.
`update public.bookings set updated_at = now() where created_at >= '2026-11-18';`

## Prüfen

1. Im Rechner eine Testbuchung abschicken (oder im CarHandling-Projekt eine Zeile ändern).
2. Webhook-Protokoll im CarHandling-Projekt: Antwort **200** mit `"status": "imported"`.
3. In der App: Fahrzeugliste → Buchung mit Kennzeichen **Rechner**; Prüfliste → Eintrag „CarHandling-Backend“.
4. Antworten: `401` = Secret falsch/fehlt · `422` = Datensatz unvollständig (Grund in der Prüfliste) · `500` = Fehler bei uns.

## Bekannte Grenzen

- **Kapazität:** Das CarHandling-Backend kennt Parkos- und manuelle Buchungen aus unserem Dashboard nicht. Die Halle
  kann dort also als frei gelten, obwohl sie bei uns voll ist. **Entschieden (24.11.2026): Der Abgleich in Gegenrichtung wird gebraucht**, als nächster Schritt.
- **Check-in:** Ankünfte, die im CarHandling-Check-in gescannt werden, kommen nicht als Ankunft in unsere App
  (nur der Ticket-Link steht in der Notiz). **Entschieden (24.11.2026):** erst in einem späteren Schritt zusammenführen.
- Das Format der CarHandling-Tabelle ist noch nicht bestätigt; die Zuordnung oben ist eine [ANNAHME] und wird
  angepasst, sobald ein echter Datensatz vorliegt.
