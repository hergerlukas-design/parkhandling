# Änderungsprotokoll

Alle nennenswerten Änderungen am Park & Fly Manager. Versionierung nach [SemVer](https://semver.org/lang/de/):
`patch` = Fehlerbehebung, `minor` = neue Funktion, `major` = Breaking Change (Pflicht-Update).

## 0.3.0 – 23.09.2026

### Neu
- Media-Service mit Speicher-Abstraktion `MediaStore` (`src/lib/media/`); erste Implementierung Supabase Storage, DB speichert nur provider/bucket/path
- Bild-Pipeline im Browser (Web Worker): WebP-Vollbild max. 1600 px (~250 KB) und Thumbnail 320 px (~20 KB), EXIF-Ausrichtung berücksichtigt, GPS/EXIF entfernt; JPEG-Fallback ohne WebP-Encoder
- Unterschriften als verkleinertes PNG
- Direkter Upload vom Gerät per Signed Upload URL (Edge Function `media-sign`) mit Größenlimit und Rate-Limit pro Gerät
- Private Buckets `media` und `media-archive` mit hartem Größen- und Typlimit; Auslieferung nur über kurzlebige, gecachte Signed URLs
- Offline-Queue in IndexedDB mit automatischem Hochladen, Backoff und sichtbarem Upload-Status
- Thumbnails mit Lazy Loading, Vollbild erst in der Lightbox
- Einstellungen zeigen Speicherverbrauch und Anzahl Dateien

## 0.2.0 – 23.09.2026

### Neu
- Datenmodell als Supabase-Migrationen: Buchungen, Leistungen, Aufgaben, Medien, Orte, Bewegungen, Schlüssel, Protokolle, Shuttle/Vallet, Buchungshistorie, Einstellungen, Personalprofile
- Automatik: Grundreinigung wird immer gebucht, jede gebuchte Leistung erzeugt eine Aufgabe (Laden/Tanken mit eigenem Aufgabentyp)
- Status-Flow: Aufgabe in Arbeit → „In Arbeit“, alle Leistungsaufgaben erledigt → „Bereit“, neue Leistung → zurück
- Stornierte Leistungen und Buchungen stornieren offene Aufgaben (keine Löschung); Änderungen der Abholzeit verschieben Fälligkeiten
- Bewegungshistorie pflegt den aktuellen Ort der Buchung und den Status der Stellplätze (Halle: freie Plätze über belegter Ebene = „nur mit Umsetzen“)
- Buchungshistorie protokolliert Umbuchungen und Leistungsänderungen mit Quelle
- Zugriffsschutz (RLS): nur freigeschaltetes Personal, Katalog und Einstellungen nur für Admins, Historien append-only
- Realtime für Stellplätze, Aufgaben und Transportaufträge; Indizes laut Kostenkonzept
- Stammdaten: Leistungskatalog (vorläufig), Halle 12 Regale × 3 Ebenen, Außen A (mit Plane) und B, Arbeits-, Puffer- und Transitorte, Standard-Einstellungen
- Datenbank-Tests (`npm run test:db`) gegen lokale Postgres-Instanz

## 0.1.0 – 23.09.2026

### Neu
- Projekt-Setup mit React 19, TypeScript, Vite, Tailwind CSS 4 und Supabase-Client
- PWA (installierbar, offlinefähige App-Hülle) über vite-plugin-pwa mit `registerType: 'prompt'`
- Aktualisierungs-Flow: Prüfung beim Start, bei Rückkehr in den Vordergrund und alle 10 Minuten über Service Worker und `version.json`
- Update-Banner mit Link zum Änderungsprotokoll; Pflicht-Dialog bei Major-Versionen
- Updates werden zurückgehalten, solange ein Protokoll, eine Unterschrift oder ein Check-in offen ist; Formularentwürfe werden in IndexedDB gesichert
- App-Hülle mit Seitenleiste (Tablet) und Bottom-Bar (Smartphone), Versionsanzeige in Footer und Einstellungen
- Deployment-Konfiguration für Fly.io (statisches Frontend, Auto-Stop)
