---
description: Review-Notizen der Landingpage (landing/review/NOTES.md) umsetzen
---

Setze die offenen Review-Notizen der Landingpage um.

1. Lies `landing/review/NOTES.md` (Übersicht) und `landing/review/notes.json` (Rohdaten). Gibt es die Dateien
   nicht, sag Bescheid: Notizen entstehen mit `npm run dev` in `landing/` über den Knopf „Markieren“.
2. Sieh dir zu jedem offenen Punkt den Screenshot `landing/review/screens/<nr>.png` an, falls vorhanden
   (rot = Stift, gelb = markierter Text, gestrichelt blau = Element, die Zahl ist die Punktnummer).
3. Finde die Stelle im Code unter `landing/src/` über markierten Text, Elementtexte, Abschnitt
   (`data-review-label`) und CSS-Pfad. Nur `landing/` ändern, nichts in `src/` der internen App.
4. Setze die Punkte um. Ist ein Punkt unklar oder widerspricht er `docs/PARK_AND_FLY_Arbeitsanweisung.md`
   oder `ANNAHMEN.md`, nicht raten: am Ende als Rückfrage auflisten und den Punkt offen lassen.
5. Setze bei umgesetzten Punkten in `landing/review/notes.json` `"status": "erledigt"` und
   `"updatedAt"` auf die aktuelle Zeit. `NOTES.md` wird beim nächsten `npm run dev` + Speichern neu
   erzeugt; aktualisiere sie trotzdem passend (Punkt von „Offen“ nach „Erledigt“, Zähler im Stand).
6. Version in `landing/package.json` nach SemVer erhöhen (Texte/kleine Korrekturen = patch, neue Funktion
   = minor) und `landing/CHANGELOG.md` mit Datum und Stichpunkten auf Deutsch ergänzen.
7. Prüfen: in `landing/` `npm run typecheck`, `npm test`, `npm run build`.
8. Zum Schluss: Liste der erledigten Punkte (#Nummer + was geändert wurde) und der offenen Rückfragen.

$ARGUMENTS
