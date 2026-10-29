# Review-Notizen Landingpage

> Erzeugt vom Markier-Werkzeug (`npm run dev` in `landing/`, Knopf „Markieren“ unten links).
> Nicht von Hand bearbeiten – Änderungen im Werkzeug machen. Rohdaten: `notes.json`.

## Anleitung für Claude Code

Setze die **offenen** Punkte in `landing/` um. Zu jedem Punkt gibt es die Seite, die Notiz, den
markierten Text bzw. die markierten Elemente (Text und CSS-Pfad zum Suchen im Code) und, falls
vorhanden, einen Screenshot mit der Markierung (rot = Stift, gelb = Text, gestrichelt = Element).
Danach in `notes.json` beim Punkt `"status": "erledigt"` setzen, die Version in `landing/package.json`
nach SemVer erhöhen und `landing/CHANGELOG.md` ergänzen. Unklare Punkte nicht raten, sondern nachfragen.

Stand: landing 0.10.0 · 1 offen · 8 erledigt

## Offen

### #9 · `/` · Stift

**Notiz:** Neue Lste für Tage

- Markierte Elemente:
  - `article` „Indoor Premium Shuttle zum Terminal: Direkt 5–8 Tage 148,00 € 9–15 Tage 249,00 …“ – `section[data-review="startseite-tarife"] > div > article:nth-of-type(4)`
- Bildschirm: 1280 × 551 px, Bereich x 1109, y 714, 115 × 11 px
- Erstellt: 27.10.2026 13:03

## Erledigt

- #1 `/`: Cover anstelle space
- #2 `/`: ändern zu geräumiger Aussenstellplatz
- #3 `/`: wie 2
- #4 `/anfrage?tarif=business`: günstigere Tarife nicht anzeigen.
- #5 `/anfrage?tarif=business`: Fallsa halle voll, sperren oder Ausverkauft Banner
- #6 `/anfrage?tarif=business`: wie 5
- #7 `/`: mind. 12h vorher buchen oder datum erst ab da wählbar. heute +1 bzw. 12h.
- #8 `/`: outdoor
