# Park & Fly – Landingpage

Öffentliche Landingpage, auf die Anzeigen verlinken. Besucher sehen die Angebote und senden eine
**unverbindliche Anfrage**. Die Anfrage landet in Supabase (Tabelle `inquiries`) und wird vom Betrieb
manuell bestätigt. Online-Buchung, Verfügbarkeit, Preise und Zahlung sind Stufe 2.

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
| `/` | Angebote: Halle Premium (Indoor), Außen mit Abdeckplane, Außen ohne Plane, Shuttle, Fahrzeugaufbereitung. Preise „auf Anfrage“ |
| `/anfrage` | Formular; `?stellplatz=indoor\|outdoor_cover\|outdoor\|any` wählt die Stellplatzart vor |
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
