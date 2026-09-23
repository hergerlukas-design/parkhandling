# Park & Fly Manager

Interne PWA zur Steuerung eines Park & Fly Betriebs (Einlagerung Halle/Außen, Leistungen,
Aufbereitung, Shuttle/Vallet, Annahme-/Übergabeprotokolle).

Stack: React 19 · TypeScript · Vite · Tailwind CSS 4 · Supabase · Fly.io (nur statisches Frontend).

## Entwicklung

```bash
cp .env.example .env.local   # Supabase-URL und anon Key eintragen
npm install
npm run dev                  # http://localhost:5173
npm test                     # Unit-Tests (Vitest)
npm run build                # Typecheck + Produktions-Build nach dist/
```

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
fly deploy --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=...
```

nginx liefert `/assets/*` unveränderlich gecacht aus, `index.html`, `sw.js`, `version.json` und
`CHANGELOG.md` ohne Cache. Auto-Stop ist aktiv.
