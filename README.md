# Park & Fly Manager

Interne PWA zur Steuerung des Park & Fly Betriebs am Flughafen München.

- Verbindliche Regeln: [`docs/PARK_AND_FLY_Arbeitsanweisung.md`](docs/PARK_AND_FLY_Arbeitsanweisung.md)
- Umfang Phase 1: [`docs/PHASE1_Startauftrag.md`](docs/PHASE1_Startauftrag.md)
- Platzhalterwerte und offene Fragen: [`ANNAHMEN.md`](ANNAHMEN.md)
- UI-Referenz (Klick-Prototyp): [`mockup/index.html`](mockup/index.html) im Browser öffnen

Stack: React 19 · TypeScript · Vite · Tailwind CSS 4 · Supabase · Fly.io (nur statisches Frontend).

## Entwicklung

```bash
cp .env.example .env.local   # Supabase-URL und Publishable Key eintragen
npm install
npm run dev                  # http://localhost:5173
npm test                     # Unit-Tests
npm run build                # Typecheck + Produktions-Build nach dist/
```

## Supabase

- Migrationen: `supabase/migrations/` (Schema, Trigger, RLS, Storage, `upsert_booking`)
- Stammdaten laut `ANNAHMEN.md`: `psql "$DATABASE_URL" -f supabase/seed.sql` (idempotent)
- 40 Demo-Buchungen: `psql "$DATABASE_URL" -f supabase/demo.sql` (wiederholbar, ersetzt vorhandene Demo-Daten)
- Lokale DB-Tests (Postgres nötig): `npm run test:db`
- Neue Konten sind inaktiv, bis ein Admin `profiles.active` setzt.

Hinweis Projekt `parkhandling`: Das Schema des ersten Anlaufs liegt unverändert im Schema `legacy_v1`
(nicht über die API erreichbar). Es kann bei Bedarf im SQL-Editor entfernt werden:
`drop schema legacy_v1 cascade;`

## Versionierung (Pflicht bei jeder Änderung)

Version in `package.json` erhöhen (`patch` / `minor` / `major`, siehe Arbeitsanweisung Grundregel 1) und
`CHANGELOG.md` ergänzen. Die Version wird zur Build-Zeit als `__APP_VERSION__` eingesetzt.

## Aktualisierungs-Flow

`vite-plugin-pwa` mit `registerType: 'prompt'`; der Build erzeugt `version.json`. Die App prüft beim Start,
bei Rückkehr in den Vordergrund und alle 10 Minuten. Offene Vorgänge halten Updates zurück
(`useUpdateBlocker`), Formulare sichern Entwürfe in IndexedDB (`useDraft`).

## Deployment (Fly.io)

```bash
fly deploy --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=...
```

Die vollständige Anleitung (Seed-Befehl, Testablauf) folgt am Ende von Phase 1.
