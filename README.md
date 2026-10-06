# Park & Fly Manager

Interne PWA zur Steuerung des Park & Fly Betriebs am Flughafen München: Buchungen, Lageplan mit
3-Ebenen-Regalen, Ein-/Auschecken per QR, Aufgaben mit Fotos, Annahme-/Übergabeprotokoll mit
Unterschrift und PDF, Tagesübersicht.

- Verbindliche Regeln: [`docs/PARK_AND_FLY_Arbeitsanweisung.md`](docs/PARK_AND_FLY_Arbeitsanweisung.md)
- Umfang Phase 1: [`docs/PHASE1_Startauftrag.md`](docs/PHASE1_Startauftrag.md)
- Platzhalterwerte und offene Fragen: [`ANNAHMEN.md`](ANNAHMEN.md)
- Änderungen je Version: [`CHANGELOG.md`](CHANGELOG.md)
- UI-Referenz (Klick-Prototyp): [`mockup/index.html`](mockup/index.html) im Browser öffnen

Stack: React 19 · TypeScript · Vite · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage, Realtime,
Edge Functions) · Fly.io (nur statisches Frontend).

## Einrichtung

### 1. Frontend

```bash
npm install
npm run dev                  # http://localhost:5173
```

| Variable | Wo | Inhalt |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` (eingecheckt) | Projekt-URL |
| `VITE_SUPABASE_ANON_KEY` | `.env` (eingecheckt) | Publishable Key – öffentlich, Zugriff über Login + RLS geschützt |

Abweichungen lokal in `.env.local` (nicht eingecheckt). Der service_role-Key gehört **nie** ins Repo.

### 2. Datenbank

Migrationen in `supabase/migrations/` der Reihe nach ausführen (Supabase CLI `supabase db push` oder
SQL-Editor). Danach:

```bash
psql "$DATABASE_URL" -f supabase/seed.sql   # Stammdaten: Stellplätze, Schlüssel, Leistungen, Einstellungen (idempotent)
psql "$DATABASE_URL" -f supabase/demo.sql   # 40 Demo-Buchungen relativ zu heute (wiederholbar, ersetzt Demo-Daten)
```

`demo.sql` enthält absichtlich eine falsch sortierte Regalspalte (R6), damit Konflikt-Banner und
Umsetz-Aufgabe sichtbar sind.

### 3. Konten

Registrieren bzw. im Supabase-Dashboard unter *Authentication* anlegen. Neue Konten sind **inaktiv**,
bis ein Admin sie freischaltet:

```sql
update public.profiles set active = true, role = 'admin' where id = (select id from auth.users where email = 'name@firma.de');
```

### 4. Edge Functions

```bash
supabase functions deploy media-sign      # Signed Upload URLs für Fotos/Unterschriften/PDFs
supabase functions deploy protocol-mail   # Versand des Protokoll-PDFs
```

Secrets (Dashboard → Edge Functions → Secrets), nur für den Mailversand nötig:

| Secret | Inhalt |
|---|---|
| `RESEND_API_KEY` | API-Schlüssel des Mail-Dienstes [Resend](https://resend.com) |
| `MAIL_FROM` | Absender, z. B. `Park & Fly <protokolle@ihre-domain.de>` (Domain bei Resend verifiziert) |

Ohne diese Secrets bleibt alles funktionsfähig; am Protokoll steht dann „Mail-Dienst noch nicht
eingerichtet“. Im Prototyp gehen **alle** Mails nur an `settings.mail_test_address`
(`mail_mode = 'test'`), Betreff mit „[TEST]“:

```sql
update public.settings set value = '"ihre-test@adresse.de"' where key = 'mail_test_address';
```

## Prüfen

```bash
npm run typecheck            # TypeScript
npm test                     # Unit-Tests (Vitest): Import, Regal-Logik, Protokolle, Heute-Ansicht …
npm run test:db              # Datenbank-Tests gegen lokales Postgres 16 (Trigger, RLS-Helfer, Regal-Logik, Protokolle)
npm run build                # Typecheck + Produktions-Build nach dist/
```

`test:db` legt eine Wegwerf-Datenbank an, spielt Migrationen + Seed ein und führt
`supabase/tests/*.test.sql` aus (läuft Postgres nicht: `pg_ctlcluster 16 main start`).

## Testablauf Phase 1 (Abnahme)

Am besten mit einem Tablet (Querformat) und einem Smartphone parallel, angemeldet mit zwei Konten.

1. **Excel-Import:** *Fahrzeuge → Import* mit [`docs/testdaten/Buchungsliste_Test_5_Zeilen.xlsx`](docs/testdaten/Buchungsliste_Test_5_Zeilen.xlsx)
   (Vorlage „ParkHandling_Buchungsliste“, Blatt „Buchungseingänge“). Erwartung: 5 neu angelegt.
   Dieselbe Datei erneut importieren → 5 unverändert, keine Duplikate. In der Datei Abholung einer Zeile
   ändern und importieren → 1 aktualisiert, Änderung im Buchungsverlauf sichtbar.
2. **Drei Testfahrzeuge** (je eines Halle, Außen mit Plane, Außen; eines davon Elektro) – für jedes:
   1. *Fahrzeug öffnen → Protokolle → Annahme starten.* KM, Tank/Akku, Fotos, ggf. Schaden mit Foto,
      Unterschrift Kunde + Mitarbeiter, *Abschließen & PDF senden*. PDF über *PDF teilen / herunterladen* prüfen.
   2. *Weiter zum Einchecken:* Schlüssel-QR scannen (oder freien Schlüssel wählen), Platzvorschlag
      übernehmen. Halle: Vorschlag folgt „früheste Abholung nach unten“.
   3. *Aufgaben:* Teilschritte abhaken, Fotos aufnehmen, *Erledigt*. Sind alle Leistungen erledigt,
      steht das Fahrzeug auf **bereit**.
   4. *Auschecken:* Fahrzeug-Detail → *Auschecken* (z. B. in die Übergabezone) → *Protokolle → Übergabe*.
      Vergleich zur Annahme prüfen, unterschreiben, abschließen, *Fahrzeug übergeben*.
3. **Regal-Konflikt:** Ein Fahrzeug in E2/E3 einer Halle-Spalte per *Bearbeiten* auf eine frühere Abholung
   als das Fahrzeug darunter umbuchen → Konflikt-Banner im Lageplan und Umsetz-Aufgabe auf dem Board.
   Nach dem Umsetzen schließt sich die Aufgabe automatisch.
4. **Update-Banner:** Version in `package.json` erhöhen, neu bauen und ausliefern. Auf einem Gerät ist ein
   Protokoll offen → Banner zeigt „Nach Abschluss aktualisieren“ und lädt nicht neu; nach Abschluss bzw.
   Verlassen des Protokolls lässt sich aktualisieren. Entwürfe bleiben erhalten.
5. **Heute-Ansicht:** Ankünfte/Abholungen, Hinweise und Belegung stimmen mit Fahrzeugliste und Lageplan überein.

Fotos, Unterschriften und PDFs werden im Browser komprimiert und direkt in den privaten Storage geladen
(Signed URLs); Listen zeigen nur Thumbnails. Ohne Netz landen sie in der Upload-Warteschlange (Banner oben)
und werden automatisch nachgeladen.

## Versionierung (Pflicht bei jeder Änderung)

Version in `package.json` erhöhen (`patch` / `minor` / `major`, siehe Arbeitsanweisung Grundregel 1) und
`CHANGELOG.md` ergänzen. Die Version wird zur Build-Zeit als `__APP_VERSION__` eingesetzt; eine zweite,
manuell gepflegte Versionskonstante gibt es nicht.

## Aktualisierungs-Flow

`vite-plugin-pwa` mit `registerType: 'prompt'`; der Build erzeugt `version.json`. Die App prüft beim Start,
bei Rückkehr in den Vordergrund und alle 10 Minuten. Offene Vorgänge (Protokoll, Check-in, Formulare)
halten Updates zurück (`useUpdateBlocker`), Entwürfe liegen in IndexedDB (`useDraft`, Protokoll-Entwürfe).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/pages/` | Seiten: Heute, Lageplan, Fahrzeuge, Fahrzeug-Detail, Einchecken, Scannen, Aufgaben, Protokoll, Einstellungen |
| `src/booking-adapters/` | Adapter-Schicht für Buchungen (manuell, Excel/CSV); einziger Schreibweg `upsert_booking` |
| `src/lib/media/` | Media-Service: Komprimierung im Worker, Upload-Queue, Signed URLs, austauschbarer Speicher |
| `src/lib/pdf/` | PDF-Vorlage aus *fahrzeug-protokolle-v2* (pdf-lib) |
| `supabase/migrations/` | Schema, Trigger, RLS, Views, Regal-Logik, Protokolle |
| `supabase/functions/` | Edge Functions `media-sign`, `protocol-mail` |
| `supabase/tests/` | Datenbank-Tests |

## Deployment (Fly.io)

Automatisch: Jeder Merge auf `main` startet `.github/workflows/deploy.yml` (Typecheck, Tests, Build,
dann `flyctl deploy`, fehlende öffentliche IP-Adressen vergeben, Erreichbarkeit der neuen Version prüfen). Einmalig nötig:

1. Token erzeugen: `fly tokens create deploy -a parkhandling`
2. Auf GitHub unter *Settings → Secrets and variables → Actions* als `FLY_API_TOKEN` speichern
3. Optional manuell starten: *Actions → Deploy (Fly.io) → Run workflow*

Manuell von einem Rechner mit `flyctl`:

```bash
fly deploy
```

Das Docker-Image baut das Frontend und liefert `dist/` über nginx aus (`deploy/nginx.conf`, `fly.toml`).
`index.html`, `sw.js` und `version.json` werden nie gecacht, gehashte Assets dauerhaft.

Hinweis Projekt `parkhandling`: Das Schema des ersten Anlaufs liegt unverändert im Schema `legacy_v1`
(nicht über die API erreichbar) und kann bei Bedarf entfernt werden: `drop schema legacy_v1 cascade;`
