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

Bestätigt am 24.11.2026 (Perplexity): Tabelle `public.bookings` mit u. a. `booking_ref`, `status`, `tariff_code`,
`arrival_date`/`arrival_time`, `pickup_date`/`pickup_time`, `amount`, `language`, `plate`, `vehicle_model`, `fuel_type`,
`charging`, `return_mode`, `flights`, `persons`, `child_seats`, `luggage`, `first_name`, `last_name`, `email`, `phone`,
`company`, `notes`, `paid_amount`, `paid_at`, `checkin_token`, `checked_in_at`. Zusätzlich gilt:

- `charging = true` → Leistung **Laden** (10,00 € Pauschale im Betrag)
- Ohne `paid_at` und mit einem offenen Status (`pending`, `open`, `awaiting_payment` …) wird eine **neue** Buchung
  noch nicht angelegt; `expired`/`failed` gilt als Storno
- Fingerprint, Stripe-IDs und Check-in-Token kommen nicht ins Protokoll

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

## Buchungsnummern für Telefonbuchungen

Schema siehe Übersicht „Buchungsnummern“ (Stand November 2026): `PH` + Anreisetag `JJMMTT` + Platz/Tarif
(`OEC` Economy, `OE+` Economy +, `IB` Business, `IP` Premium) + Service (`SH` Shuttle, `SE` selbst, `VA` Hol-/Bring)
+ laufende Nummer je Anreisetag über alle Tarife. Vergeben wird **nur bei CarHandling** (gemeinsamer Zähler mit dem
Rechner). Unsere Edge Function `booking-ref` ruft dazu `POST https://orqkeiveksshijktxepv.supabase.co/functions/v1/next-booking-ref`
mit Header `x-ref-secret` (Secret `CARHANDLING_REF_SECRET` bei uns, `PARKHANDLING_REF_SECRET` bei CarHandling) und
Body `{ arrival_date, tariff, service, reference }` auf; Antwort `{ booking_ref }`. Gleiche `reference` (unsere
Buchungs-ID) liefert immer dieselbe Nummer.

## Kunden-QR-Code und Annahme (0.39.0)

Der Kunde bekommt nach der Buchung einen QR-Code mit dem Link `https://parkhandling-rechner.pplx.app/ticket.html#<Ticket-Code>`
(32 Hex-Zeichen, Spalte `checkin_token` bei CarHandling). Die Annahme läuft im Dashboard:

```
Kunden-QR ──scan──► Dashboard: find_booking_by_scan → Annahmeprotokoll → Einchecken (Stellplatz)
                                         │ Protokoll abgeschlossen
                                         ▼
                    carhandling-checkin ──POST──► CarHandling checkin-status (checked_in_at)
                                                          │ Database Webhook
                                                          ▼
                    booking-sync ◄─────────────── carhandling_checked_in_at bei uns
```

- `booking-sync` speichert den Ticket-Code nur als SHA-256 (`bookings.checkin_token_hash`) sowie `checked_in_at`/`checked_out_at`
  als `carhandling_checked_in_at`/`carhandling_checked_out_at`.
- Scan in der App (`/scan`): Ticket-Link, reiner Ticket-Code oder Buchungsnummer `PH…`.
- Einstiege für die Mitarbeiterseite von `ticket.html`: `https://parkhandling.fly.dev/annahme#<Ticket-Code>` und
  `https://parkhandling.fly.dev/rueckgabe#<Ticket-Code>`.
- Meldung an CarHandling: Annahmeprotokoll abgeschlossen → `op: "checkin"`, Übergabeprotokoll abgeschlossen → `op: "checkout"`.
  `POST https://orqkeiveksshijktxepv.supabase.co/functions/v1/checkin-status`, Header `x-ref-secret`, Body
  `{ booking_ref, op, at }`, Antwort `{ booking_ref, checked_in_at, checked_out_at }`. Gemeldet wird nur, was dort laut
  Webhook noch fehlt; nicht durchgegangene Meldungen holt die Fahrzeugliste einmal je Sitzung nach (`{ pending: true }`).
- Auf CarHandling-Seite noch umzusetzen: Edge Function `checkin-status`, Knöpfe auf `ticket.html` (Auftrag an Perplexity, 25.11.2026).

## Prüfen

1. Im Rechner eine Testbuchung abschicken (oder im CarHandling-Projekt eine Zeile ändern).
2. Webhook-Protokoll im CarHandling-Projekt: Antwort **200** mit `"status": "imported"`.
3. In der App: Fahrzeugliste → Buchung mit Kennzeichen **Rechner**; Prüfliste → Eintrag „CarHandling-Backend“.
4. Antworten: `401` = Secret falsch/fehlt · `422` = Datensatz unvollständig (Grund in der Prüfliste) · `500` = Fehler bei uns.

## Bekannte Grenzen

- **Kapazität:** Das CarHandling-Backend kennt Parkos- und manuelle Buchungen aus unserem Dashboard nicht. Die Halle
  kann dort also als frei gelten, obwohl sie bei uns voll ist. **Entschieden (24.11.2026): Der Abgleich in Gegenrichtung wird gebraucht**, als nächster Schritt.
- **Check-in:** Seit 0.39.0 läuft die Annahme per Kunden-QR im Dashboard und wird an CarHandling gemeldet. Ein Check-in,
  der nur bei CarHandling gedrückt wird, steht im Fahrzeug-Detail („Ticket CarHandling“), setzt aber keine Ankunft und
  keinen Stellplatz bei uns.
- Das Format der CarHandling-Tabelle ist noch nicht bestätigt; die Zuordnung oben ist eine [ANNAHME] und wird
  angepasst, sobald ein echter Datensatz vorliegt.
