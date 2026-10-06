# Änderungsprotokoll

Alle nennenswerten Änderungen am Park & Fly Manager. Versionierung nach [SemVer](https://semver.org/lang/de/):
`patch` = Fehlerbehebung, `minor` = neue Funktion, `major` = Breaking Change (Pflicht-Update).

## 0.8.1 – 06.10.2026

### Intern
- Datenbank für Protokolle vorbereitet: Entwurf/abgeschlossen, Prüfer, Ort, FIN, Bedingungen, Checkliste, Kunden-Unterschrift, Mail-Status; abgeschlossene Protokolle sind unveränderlich (Trigger), je Buchung höchstens ein Annahme- und ein Übergabeprotokoll
- Medien erhalten einen Foto-Slot (z. B. vorne, schaden_0, signature); Media-Service kann PDFs hochladen
- Edge Function `protocol-mail` vorbereitet: versendet das Protokoll-PDF im Prototyp nur an die Testadresse, ohne eingerichteten Mail-Dienst wird „nicht eingerichtet“ vermerkt
- Datenbank-Test `60_protocols`

## 0.8.0 – 06.10.2026

### Neu
- Aufgaben-Board nach Klick-Prototyp: Spalten Offen / In Arbeit / Erledigt heute (Smartphone als Tabs), Filter Aufbereitung, Laden/Tanken, Umsetzen, Service, „Nur heute fällig“, sortiert nach Fälligkeit, überfällige Fristen rot, Live-Aktualisierung über Realtime
- Aufgabe öffnen (Board oder Fahrzeug-Detail): Teilschritte abhaken (erster Haken startet die Aufgabe), Fotos aufnehmen über den Media-Service (Komprimierung, Offline-Queue, nur Thumbnails in der Liste), Notiz, Starten / Erledigt / Wieder öffnen
- Wer eine Aufgabe begonnen bzw. erledigt hat, wird mit Zeit gespeichert und auf den Karten angezeigt
- Umsetz-Aufgaben zeigen Anzahl Bewegungen und verlinken in den Lageplan
- Sind alle Leistungsaufgaben erledigt, wechselt das Fahrzeug automatisch auf „bereit“
- View `task_board` (Aufgabe mit Fahrzeug, Ort, Leistung, Personen, Fotoanzahl)

## 0.7.0 – 06.10.2026

### Neu
- Lageplan nach Klick-Prototyp: Halle als Regalraster (Tablet R1–R8 × E3–E1, Smartphone je Regal eine Zeile), Außen A/B als Reihen mit Platznummern, Arbeitsorte/Puffer/unterwegs mit Auslastung; Farben nach Abholdatum, freie Plätze gestrichelt, „nur mit Umsetzen“ grau; Kapazitätsanzeige Halle/Außen; Konflikt-Banner je Regalspalte; Live-Aktualisierung über Realtime
- Detailpanel rechts (Tablet) bzw. als Bottom-Sheet (Smartphone) mit Auschecken, Umsetzen, Details; freie Plätze mit „Fahrzeug hier einchecken“
- Einchecken in Schritten: Fahrzeug wählen → Schlüssel scannen oder freies Fach wählen → Platzvorschlag (Halle über Regal-Logik, Außen nach Abdeckplane) → bestätigen per Button oder Stellplatz-QR; Hinweis bei offenen Leistungen mit „Erst Aufbereitung“; Abweichung vom Vorschlag wird als Warnung angezeigt; App-Updates werden während des Check-ins zurückgehalten
- Auschecken/Umsetzen/Übergeben mit Zielauswahl (Aufbereitung, Ladeplatz, Übergabezone, Vallet unterwegs, anderer Stellplatz, Übergabe); Regelverstöße meldet die Datenbank im Klartext
- Scannen: Schlüssel frei → Einchecken, Schlüssel belegt → Fahrzeug, Stellplatz → Lageplan; Kamera über BarcodeDetector bzw. jsQR (iPad/iPhone), manuelle Eingabe immer möglich
- Fahrzeug-Detail: Einchecken bzw. Umsetzen/Auschecken direkt im Bereich „Ort & Schlüssel“, Link „Im Lageplan zeigen“

## 0.6.0 – 05.10.2026

### Neu
- Regal-Logik Halle (Abschnitt 5) als Datenbankfunktionen mit Tests:
  - `suggest_hall_location`: Platzvorschlag „passt“ / „nicht geeignet“ / „nur mit Umsetzen (N Bewegungen)“, Pufferplatz als Ausweichmöglichkeit
  - `check_column`: Konflikte einer Regalspalte inkl. Anzahl Umsetzvorgänge
  - Automatische Umsetz-Aufgaben bei Konflikten (auch nach Umbuchung), fällig vor der früheren Abholung; aufgelöste Konflikte schließen ihre Aufgabe
- `move_vehicle`: einziger Weg für Ein-/Auschecken und Umsetzen – prüft „Einlagern von oben, Auslagern von unten“, Belegung und Kapazität, setzt Status (eingelagert, unterwegs, übergeben), ordnet Schlüsselfach zu bzw. gibt es frei, warnt bei offenen Leistungen auf E2/E3 und bei Abweichung von der Sollreihenfolge
- View `location_board` (Belegung je Ort für den Lageplan)

## 0.5.0 – 05.10.2026

### Neu
- Anmeldung (E-Mail + Passwort) mit Freischaltprüfung; Konto und Abmelden in den Einstellungen
- Fahrzeugliste nach Klick-Prototyp: Suche (Kennzeichen, Kunde, Firma, Buchungs-Nr.), Filter-Chips mit Anzahl (Halle, Außen, Heute raus, Offene Leistungen, Laden/Tanken, Storniert), Abholung mit Farbpunkt nach Datum, Leistungs-Chips, Spalte Zahlungsstatus; Smartphone als Karten mit Farbbalken
- Fahrzeug-Detail: Buchung, Ort & Schlüssel, Leistungen mit Fortschritt, Protokolle (Platzhalter), Verlauf aus Bewegungen und Buchungshistorie; Bearbeiten und Stornieren
- Hinweis bei importierten Buchungen mit unsicherem Kennzeichen
- Datenbank-View `booking_list` für die Liste (eine Abfrage, RLS des Aufrufers)
- Testdatei `docs/testdaten/Buchungsliste_Test_5_Zeilen.xlsx` im Format der Vorlage

### Behoben
- Excel-Uhrzeiten werden auf Minuten gerundet (Excel liefert 07:00 als 06:59:59.999)

### Geändert
- Öffentliche Supabase-Werte (URL, Publishable Key) stehen in der eingecheckten `.env`; Fly-Deploy ohne Build-Argumente

## 0.4.1 – 05.10.2026

### Behoben
- Migrationen laufen auch auf einem Projekt mit vorhandenem Altschema: Login-Trigger wird ersetzt statt neu angelegt, Storage-Policies werden nur angelegt, wenn sie fehlen
- Neues Schema, Stammdaten und Demo-Buchungen im Supabase-Projekt eingespielt; Altschema liegt in `legacy_v1`

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
