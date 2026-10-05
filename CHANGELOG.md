# Änderungsprotokoll

Alle nennenswerten Änderungen am Park & Fly Manager. Versionierung nach [SemVer](https://semver.org/lang/de/):
`patch` = Fehlerbehebung, `minor` = neue Funktion, `major` = Breaking Change (Pflicht-Update).

## 0.4.0 – 05.10.2026

### Neu
- Buchungsadapter für die Excel-Vorlage „ParkHandling_Buchungsliste“ (Sheet „Buchungseingänge“): Kopfzeile wird auch unter Titelzeilen gefunden, Kennzeichen und Fahrzeug werden getrennt (unsichere Fälle bleiben im Kennzeichen und werden mit „⚠ Kennzeichen prüfen“ markiert), Preise mit Dezimalkomma, Zahlungsstatus, Aufbereitung/Pflege, Hol- & Bringservice, Transfer und Storno werden übernommen; „Anzahl Tage“ wird berechnet statt importiert
- Buchungsformular für Anlegen und Bearbeiten mit Firma, Antrieb, Gesamtpreis, Zahlungsstatus und individuellen Preisen/Beschreibungen je Leistung
- Stornieren setzt den Status „storniert“, es wird nichts gelöscht
- `upsert_booking` kann bestehende Buchungen gezielt per id bearbeiten

## 0.3.0 – 05.10.2026

### Neu
- Media-Service mit Speicher-Abstraktion `MediaStore` (`src/lib/media/`), erste Implementierung Supabase Storage; die Datenbank speichert nur provider/bucket/path
- Bild-Pipeline im Browser (Web Worker): WebP-Vollbild max. 1600 px (~250 KB) und Thumbnail 320 px (~20 KB), EXIF-Ausrichtung berücksichtigt, GPS/EXIF entfernt; JPEG-Fallback ohne WebP-Encoder; Unterschriften als verkleinertes PNG
- Direkter Upload vom Gerät per Signed Upload URL (Edge Function `media-sign`) mit Größen- und Rate-Limit pro Gerät
- Offline-Queue in IndexedDB mit automatischem Hochladen, Backoff und sichtbarem Upload-Status
- Thumbnails mit Lazy Loading, Vollbild erst in der Lightbox; Signed URLs werden gebündelt und bis kurz vor Ablauf wiederverwendet

## 0.2.0 – 05.10.2026

### Neu
- Datenmodell als Supabase-Migrationen (Abschnitt 3): Buchungen inkl. Eingang, Firma, Gesamtpreis, Zahlungsstatus und Hol- & Bringservice; Leistungen mit optionalem Preis, Beschreibung und Teilschritten; Aufgaben mit Checkliste; Medien, Orte, Bewegungen, Schlüsselfächer, Protokolle, Shuttle, Historie, Einstellungen
- Trigger: Grundreinigung wird immer gebucht, je Leistung eine Aufgabe (mit Teilschritten), alle erledigt → „bereit“, Stornos ohne Löschen, Bewegungen pflegen aktuellen Ort und Platzstatus (Halle: „nur mit Umsetzen“), Buchungshistorie
- Buchungsschnittstelle `upsert_booking`: idempotent über Quelle + Buchungs-Nr., Umbuchungen, individuelle Preise bleiben bei Re-Import erhalten
- RLS für Rollen staff/admin, Realtime für Stellplätze, Aufgaben und Transportaufträge, Indizes laut Abschnitt 11.5
- Private Storage-Buckets mit Größenlimit, Speicherverbrauch-Abfrage
- Stammdaten laut ANNAHMEN.md (Halle 8×3, Außen A/B je 2×24, Arbeitsorte, Schlüsselfächer K-001–K-150, Leistungskatalog) und 40 Demo-Buchungen inkl. falsch sortierter Regalspalte R6
- Datenbank-Tests (`npm run test:db`)

## 0.1.0 – 05.10.2026

### Neu
- Projekt-Setup mit React 19, TypeScript, Vite, Tailwind CSS 4 und Supabase-Client
- PWA (installierbar, offlinefähige App-Hülle) über vite-plugin-pwa mit `registerType: 'prompt'`
- Aktualisierungs-Flow: Prüfung beim Start, bei Rückkehr in den Vordergrund und alle 10 Minuten über Service Worker und `version.json`
- Update-Banner mit Link zum Änderungsprotokoll; Pflicht-Dialog bei Major-Versionen
- Updates werden zurückgehalten, solange ein Protokoll, eine Unterschrift oder ein Check-in offen ist; Formularentwürfe werden in IndexedDB gesichert
- App-Hülle mit Seitenleiste (Tablet) und Bottom-Bar mit zentralem Scan-Button (Smartphone), Versionsanzeige in Footer und Einstellungen
- Deployment-Konfiguration für Fly.io (statisches Frontend, Auto-Stop)
