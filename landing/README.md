# Park & Fly – Landingpage

Öffentliche Buchungsseite. Der Button „Jetzt buchen“ auf der Jimdo-Website führt auf `/anfrage`. Der Kunde
wählt Tarif und Zeitraum, gibt seine Daten ein und bezahlt mit PayPal. Danach ist die Buchung sofort
bestätigt, landet in der Tabelle `bookings` der Park Handling App und bekommt eine Bestätigungsmail.
Stufe 2 (Version 0.2.0). Die Verfügbarkeit wird noch nicht geprüft.

> **Stand: vorbereitet, nicht live.** Go-live erst nach Klärung von Datenschutzerklärung, Impressum
> und Aufbewahrungsfrist (siehe `../OFFENE_FRAGEN.md`). Bis dahin ist die Seite `noindex`.

Eigenständige App im Unterordner `landing/` des Repos `parkhandling`:

- eigenes `package.json` (eigene Version, Start `0.1.0`), eigenes `CHANGELOG.md`, eigener Build
- eigene Fly.io-App `parkhandling-landing` (`fly.toml`, `Dockerfile`, Build-Kontext nur `landing/`)
- **kein Import aus `../src/`** der internen App, eigener Supabase-Client (nur Functions-Client)
- gemeinsam genutzt wird nur `../supabase/` (Migrationen, Edge Functions) – ein Supabase-Projekt

Stack: React 19 · TypeScript · Vite · Tailwind CSS 4 · Supabase Edge Function · Fly.io (statisch, nginx).

## Seiten

| Pfad | Inhalt |
|---|---|
| `/` | Startseite mit den Tarifen und Preisen je Dauer (aus der Datenbank) |
| `/anfrage` | Buchungsseite; `?tarif=economy\|space\|business\|premium` wählt den Tarif vor |
| `/danke` | Bestätigung nach dem Absenden |
| `/impressum`, `/datenschutz` | Platzhalter „wird vor Go-live ergänzt“ |

## Einrichtung

```bash
cd landing
npm install
npm run dev                  # http://localhost:5173
```

### Umgebungsvariablen

| Variable | Wo | Inhalt |
|---|---|---|
| `VITE_SUPABASE_URL` | `landing/.env` (eingecheckt) | Projekt-URL |
| `VITE_SUPABASE_ANON_KEY` | `landing/.env` (eingecheckt) | Publishable Key – öffentlich; die Seite ruft damit nur die Edge Function auf |

Abweichungen lokal in `landing/.env.local` (nicht eingecheckt). Mail-Schlüssel und der service_role-Key
gehören **nie** ins Frontend, sie liegen nur als Secrets bei der Edge Function.

### Datenbank

Migration `../supabase/migrations/20261009000400_inquiries.sql` einspielen (wie alle Migrationen,
z. B. `supabase db push`). Sie legt an:

- Tabelle `inquiries` (Status `new` → `contacted` → `converted` / `rejected`, `converted_booking_id`
  verweist später auf `bookings`), Indizes `(status, created_at)` und `(email)`
- RLS: Lesen und Status ändern nur für aktives Personal (`staff`, `admin`), **kein** Insert/Select für
  `anon` oder `authenticated` – geschrieben wird ausschließlich über die Edge Function (service_role)
- Tabelle `inquiry_rate_hits` + Funktion `inquiry_rate_check` für das Rate-Limit (nur IP-HMAC)
- Einstellungen `inquiry_notify_address` (`null` = `mail_test_address`) und
  `inquiry_customer_confirmation` (`false`)

Neue Anfragen ansehen (Supabase SQL-Editor oder Dashboard → Table Editor):

```sql
select created_at, status, arrival_date, pickup_date, parking_type, plate, first_name, last_name, email,
       services, utm_source, utm_campaign, notification_status
from public.inquiries order by created_at desc limit 50;

update public.inquiries set status = 'contacted' where id = '…';
```

### Edge Function `inquiry-submit`

```bash
# Ohne JWT-Prüfung, da die Seite anonym sendet (der Publishable Key ist kein JWT)
supabase functions deploy inquiry-submit --no-verify-jwt
```

| Secret | Pflicht | Inhalt |
|---|---|---|
| `RESEND_API_KEY` | für Mails | wie bei `protocol-mail` |
| `MAIL_FROM` | für Mails | Absender, z. B. `Park & Fly <anfrage@ihre-domain.de>` |
| `MAIL_PROVIDER` | nein | Standard `resend`; weitere Anbieter in `_shared/mailer.ts` ergänzen |
| `INQUIRY_IP_SALT` | nein | Schlüssel für den IP-HMAC (Standard: service_role-Key) |

Ablauf: Rate-Limit (5 pro IP und Stunde → `429`) → Honeypot gefüllt oder Formular in unter
3 Sekunden ausgefüllt → still verworfen (Antwort wie Erfolg, nichts gespeichert) → serverseitige
Prüfung (`422` mit Feldfehlern) → Speichern → Mail an den Betrieb. Ohne Mail-Secrets wird trotzdem
gespeichert, `notification_status = 'not_configured'`.

### Online-Buchung (Stufe 2)

Migration `../supabase/migrations/20261020000100_booking_checkout.sql` legt `booking_tariffs` (Tarife mit
Preisen je Dauer, Pflege über Admin) und `booking_checkouts` (Zwischenspeicher bis zur Zahlung) an.
Die Edge Function `booking-checkout` läuft ohne JWT-Prüfung:

```bash
supabase functions deploy booking-checkout --no-verify-jwt
```

| Secret | Inhalt |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal-REST-Zugang (nur serverseitig) |
| `PAYPAL_ENV` | `sandbox` (Standard) oder `live` |
| `MAIL_FROM`, `RESEND_API_KEY` | Bestätigungsmail an den Kunden |

Frontend: `VITE_PAYPAL_CLIENT_ID` in `landing/.env` (öffentlich). Ohne Wert zeigt die Seite
„Die Online-Zahlung ist derzeit nicht verfügbar“.

Ablauf: `tariffs` (Anzeige) → `create` (Formular prüfen, Betrag berechnen, PayPal-Bestellung anlegen) →
Kunde zahlt bei PayPal → `capture` (Zahlung prüfen: Status, Betrag, Währung) → Buchung in `bookings`
anlegen → Bestätigungsmail. Ist die Zahlung erfasst, aber die Buchung fehlt, meldet das Log
`CRITICAL` und der Kunde erhält eine Meldung, sich zu melden.

Empfänger der Benachrichtigung (Betreff im Testmodus mit „[TEST]“):

```sql
-- bis Go-live: Testadresse (gilt auch für die Protokoll-Mails)
update public.settings set value = '"ihre-test@adresse.de"' where key = 'mail_test_address';
-- ab Go-live: eigene Betriebsadresse nur für Anfragen
update public.settings set value = '"betrieb@ihre-domain.de"' where key = 'inquiry_notify_address';
```

Die Bestätigungsmail an Kunden bleibt aus, bis Mail-Anbieter und Datenschutz geklärt sind
(`inquiry_customer_confirmation = true` schaltet sie ein; im `mail_mode = 'test'` geht auch sie nur an
die Testadresse).

## Review-Notizen: markieren und mit Claude Code umsetzen

Nur lokal mit `npm run dev` (im Produktions-Build nicht enthalten):

1. `npm run dev`, Seite öffnen, unten links **„✎ Markieren“**.
2. Werkzeug wählen:
   - **Stift**: frei zeichnen – einkreisen, unterstreichen, Pfeile, auch über Bilder und Buttons.
     Weiterzeichnen ergänzt die Markierung. Auf dem Handy zum Scrollen den Stift ausschalten.
   - **Text**: Text markieren wie beim Kopieren, wird gelb hervorgehoben.
   - **Element**: Button, Bild, Feld … anklicken (der Klick löst nichts aus).
3. Notiz schreiben, **Speichern**. Nummern-Abzeichen auf der Seite öffnen die Notiz wieder
   (bearbeiten, erledigt, löschen). **Liste** zeigt alle Notizen über alle Seiten. `Esc` bricht ab.

Gespeichert wird sofort in `landing/review/`:

| Datei | Inhalt |
|---|---|
| `NOTES.md` | Aufbereitung für Claude Code: Seite, Notiz, Abschnitt, Überschrift, markierter Text, Elemente mit CSS-Pfad |
| `notes.json` | Rohdaten (Koordinaten, Striche, Status) |
| `screens/<nr>.png` | Screenshot jeder offenen Markierung, automatisch im Hintergrund |
| `backup/notes-<Zeitpunkt>.json` | Sicherung der vorherigen Fassung, vor jedem Überschreiben (die letzten 100) |

**Notizen verschwunden?** In der **Liste** auf **„Sicherungen“** klicken und beim passenden Stand
**„Wiederherstellen“** wählen. Der jetzige Stand wird vorher selbst gesichert.

Für die Screenshots einmalig `npx playwright install chromium` ausführen; ohne Browser funktioniert
alles andere trotzdem (Hinweis im Terminal).

**Umsetzen:** In Claude Code `/review-umsetzen` eingeben. Lokales Claude Code liest die Dateien
direkt. Für Claude Code im Web/in der Cloud vorher `landing/review/` committen und pushen.
Umgesetzte Punkte werden in `notes.json` auf `erledigt` gesetzt.

## Version

Die Version steht **nur** in `landing/package.json` und erscheint über Vite (`__APP_VERSION__`) im
Footer. Bei jeder Änderung an `landing/` Version nach SemVer erhöhen und `landing/CHANGELOG.md`
ergänzen (`npm version patch|minor|major --no-git-tag-version` im Ordner `landing/`). Die Version der
internen App (Root-`package.json`) bleibt davon unberührt.

## Prüfen

```bash
cd landing
npm run typecheck            # TypeScript
npm test                     # Unit-Tests: Validierung (Datum, E-Mail, Pflichtfelder, Längen), UTM, Datumsformat
npm run test:review          # Markier-Werkzeug im Dev-Server (Notizen in temporärem Ordner)
npm run test:e2e             # Playwright, Smartphone (Pixel 7, Hochformat): Startseite → Formular → /danke
                             # inkl. UTM im Request, kein horizontales Scrollen, Touch-Ziele ≥ 44 px
                             # (Edge Function wird abgefangen, es gehen keine Daten an Supabase)

# Edge Function (Deno): gültige Anfrage speichert, Honeypot verwirft, Rate-Limit greift, UTM übernommen
cd ../supabase/functions && deno test --no-lock inquiry-submit/

# Datenbank (lokales Postgres): Rechte, Prüfungen, Rate-Limit – zusammen mit allen anderen Migrationstests
cd ../.. && npm run test:db
```

Lokal ohne vorinstallierten Browser vorher `npx playwright install chromium`.

### Abnahme-Ablauf (nach Deploy, nur Testdaten)

1. Testadresse in `settings.mail_test_address` setzen, Edge Function mit Mail-Secrets deployen.
2. `https://<landing-url>/?utm_source=test&utm_medium=cpc&utm_campaign=abnahme` auf dem Smartphone
   öffnen, Formular mit Testdaten (z. B. Kennzeichen `M-TE 123`, `test@example.com`) absenden.
3. In `inquiries` prüfen: Zeile vorhanden, `utm_*` gesetzt, `notification_status = 'sent'`;
   Mail an der Testadresse angekommen.
4. Spam-Schutz: sechs Anfragen innerhalb einer Stunde → die sechste zeigt „Zu viele Anfragen“.
   Honeypot: `curl` mit gefülltem Feld `website` → Antwort `{"ok":true}`, aber keine neue Zeile.
5. Footer zeigt `Version 0.1.0` = `landing/package.json`.

## Deployment (Fly.io)

```bash
cd landing
fly apps create parkhandling-landing     # einmalig
fly deploy --remote-only
```

GitHub Actions (`.github/workflows/deploy-landing.yml`) prüft bei jeder Änderung unter `landing/**`
oder `supabase/**` (Typecheck, Unit-Tests, Build, E2E, Deno-Tests). Das **Deployment ist vorbereitet,
aber aus**: einschalten mit der Repository-Variable `LANDING_DEPLOY_ENABLED = true`. Der Workflow der
internen App (`deploy.yml`) ignoriert `landing/**`, ein reiner Landingpage-Push baut die interne App
also nicht neu – und umgekehrt.
