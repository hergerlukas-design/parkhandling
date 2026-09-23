# Park & Fly Manager

Interne PWA zur Steuerung eines Park & Fly Betriebs (Einlagerung Halle/Außen, Leistungen,
Aufbereitung, Shuttle/Vallet, Annahme-/Übergabeprotokolle).

Stack: React 19 · TypeScript · Vite · Tailwind CSS 4 · Supabase · Fly.io (nur statisches Frontend).

## Entwicklung

Supabase-URL und Publishable Key stehen in `.env` (öffentlich, eingecheckt). Abweichungen lokal in `.env.local`.

```bash
npm install
npm run dev                  # http://localhost:5173
npm test                     # Unit-Tests (Vitest)
npm run build                # Typecheck + Produktions-Build nach dist/
```

## Supabase

Migrationen liegen in `supabase/migrations`, Stammdaten in `supabase/seed.sql` (idempotent),
Edge Functions in `supabase/functions`. Lokale Tests: `npm run test:db` (benötigt Postgres).

**Erstes Admin-Konto:** Nutzer im Supabase-Dashboard unter Authentication anlegen (Selbstregistrierung
deaktivieren), dann im SQL-Editor freischalten:

```sql
update public.profiles set role = 'admin', active = true
where id = (select id from auth.users where email = 'name@firma.de');
```

Neue Konten sind inaktiv, bis ein Admin sie freischaltet (`profiles.active`).

## Versionierung (Pflicht bei jeder Änderung)

1. Version in `package.json` erhöhen (`npm version patch|minor|major --no-git-tag-version`):
   `patch` = Bugfix/Text/kleine UI-Korrektur, `minor` = neue Funktion/Feld/Ansicht,
   `major` = Breaking Change im Datenmodell oder in der Buchungsschnittstelle (**Pflicht-Update** auf allen Tablets).
2. Eintrag in `CHANGELOG.md` (Datum, Version, Stichpunkte auf Deutsch).

Die Version wird nur in `package.json` gepflegt und zur Build-Zeit als `__APP_VERSION__` eingesetzt.

## Aktualisierungs-Flow

- `vite-plugin-pwa` mit `registerType: 'prompt'` – es wird nie automatisch neu geladen.
- Der Build erzeugt `version.json` und liefert `CHANGELOG.md` aus (beide nicht im Service-Worker-Cache).
- Prüfung beim Start, bei `visibilitychange` und alle 10 Minuten (`src/lib/update/updateController.ts`).
- Offene Vorgänge halten Updates zurück: `useUpdateBlocker(active, 'Annahmeprotokoll')`.
- Formulare mit `useDraft(key, initial)` sichern ihren Stand in IndexedDB und werden nach dem Neuladen wiederhergestellt.
- Supabase-Migrationen müssen abwärtskompatibel zur Vorversion sein (erst Spalten hinzufügen, später entfernen).

## Deployment (Fly.io)

```bash
fly deploy
```

nginx liefert `/assets/*` unveränderlich gecacht aus, `index.html`, `sw.js`, `version.json` und
`CHANGELOG.md` ohne Cache. Auto-Stop ist aktiv.
