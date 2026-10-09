# Park & Fly Manager – Arbeitsanweisung für Claude Code

> **Hinweis:** Geändert durch `docs/ARBEITSANWEISUNG_Nachtrag_08-10-2026.md` (Vallet → Hol- & Bringservice, Akkustand entfällt, Kilometerstand/Tankstand, Schadensfotos, Dashboard, Stellplatz-Label). Bei Widerspruch gilt der Nachtrag.

## 0. Grundregeln (immer gültig)

1. **Version bei jeder Änderung erhöhen.** Jeder Commit, der Code, Schema oder UI ändert, erhöht die Version in `package.json` nach SemVer:
   - `patch` (1.0.x): Bugfix, Textänderung, kleine UI-Korrektur
   - `minor` (1.x.0): neue Funktion, neues Feld, neue Ansicht
   - `major` (x.0.0): Breaking Change im Datenmodell oder in der Buchungsschnittstelle
   Zusätzlich einen Eintrag in `CHANGELOG.md` (Datum, Version, Stichpunkte auf Deutsch). Die Version wird zur Build-Zeit über Vite (`define: { __APP_VERSION__ }`) in die App übernommen und in den Einstellungen sowie im Footer angezeigt. Keine zweite, manuell gepflegte Versionskonstante.
2. **Aktualisierungs-Flow nicht umgehen** (siehe Abschnitt 6). Jede neue Version muss auf allen Tablets zuverlässig ankommen, ohne dass laufende Eingaben verloren gehen.
3. **Flexibles Datenmodell.** Leistungen, Stellplätze und Bereiche sind Daten, keine Code-Konstanten. Neue Leistung = neue Zeile in `services`, kein Deploy.
4. **Buchungsschnittstelle ist noch unbekannt.** Alle Buchungsdaten laufen über eine Adapter-Schicht (Abschnitt 4). Kein Code außerhalb des Adapters darf ein bestimmtes Buchungsportal voraussetzen.
5. UI-Texte auf Deutsch. Datumsformat `TT.MM.JJJJ`, Uhrzeit 24 h, Zeitzone Europe/Berlin.
6. Mobile First, Hauptgerät Tablet quer. Touch-Ziele mindestens 44 px.
7. **Kosten und Skalierung mitdenken** (siehe Abschnitt 11). Bilder niemals unkomprimiert hochladen, niemals über den eigenen Server leiten, niemals in Postgres speichern. Listen und Übersichten laden ausschließlich Thumbnails.

## 1. Ziel

Interne PWA zur Steuerung eines Park & Fly Betriebs: Einlagerung (Halle mit abhängigen 3-Ebenen-Regalen, Außen mit/ohne Abdeckplane), gebuchte Zusatzleistungen, Aufbereitung, Laden/Tanken, Vallet- und Shuttle-Fahrten, Annahme-/Übergabeprotokoll mit Kundenunterschrift. Layout und Bedienlogik orientieren sich am ADE Fleet Manager. Das Protokoll-Layout (PDF) wird aus Vehicle Protocol Pro V2 übernommen.

Nutzer: nur internes Personal. Kunden erhalten Protokolle und Status-Mails per E-Mail. Ein Kundenportal ist eine spätere Ausbaustufe und wird jetzt nur vorbereitet (Token pro Buchung), nicht gebaut.

## 2. Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Supabase (Postgres, Auth, Storage, Realtime, Edge Functions), Deployment auf Fly.io. PWA über `vite-plugin-pwa`. Realtime-Abos für Stellplätze, Aufgaben und Transportaufträge, da mehrere Geräte gleichzeitig arbeiten.

Fly.io hostet nur das statische Frontend (kleinste Maschine, Auto-Stop aktiv). Geschäftslogik liegt in Postgres-Funktionen, Triggern und Supabase Edge Functions. Es gibt keinen eigenen Backend-Server, über den Daten oder Dateien laufen.

## 3. Datenmodell (Supabase)

Alle Tabellen mit `id uuid`, `created_at`, `updated_at`. Änderungen nur über Migrationen in `supabase/migrations`.

| Tabelle | Zweck | Wichtige Felder |
|---|---|---|
| `bookings` | Eine Buchung = ein Fahrzeug-Case | `external_ref` (Buchungs-Nr.), `source`, `received_at`, `customer_name`, `company`, `customer_email`, `customer_phone`, `plate`, `vehicle_model`, `start_at`, `end_at`, `parking_type` (`indoor`, `outdoor_cover`, `outdoor`), `return_mode` (`shuttle`, `vallet`, `pickup_delivery`, `self`), `status`, `price_total` (manuell überschreibbar), `payment_status` (`open`, `partial`, `paid`, `refunded`), `notes`, `portal_token` |
| `services` | Leistungskatalog | `code`, `name`, `category`, `price`, `active`, `is_default` (Grundreinigung = true) |
| `booking_services` | Gebuchte Leistungen | `booking_id`, `service_id`, `price_at_booking` (nullable, Preise sind teils individuell vereinbart), `description` (Freitext für individuelle Vereinbarung) |
| `tasks` | Teilschritte / Arbeitsaufträge | `booking_id`, `type` (`service`, `charge`, `fuel`, `relocate`), `service_id`, `status` (`open`, `in_progress`, `done`), `due_at`, `done_by`, `done_at`, `note` |
| `media` | Alle Dateien (Fotos, Unterschriften, PDFs) | `booking_id`, `owner_type` (`task`, `protocol`, `damage`), `owner_id`, `kind` (`photo`, `signature`, `pdf`), `provider` (`supabase`, später `r2`), `bucket`, `path`, `thumb_path`, `width`, `height`, `bytes`, `taken_at`, `retention_until`, `archived_at` |
| `locations` | Alle Orte | `code` (z. B. `R3-E1`, `A1-07`), `area` (`hall`, `outdoor_a`, `outdoor_b`, `work`, `buffer`, `transit`), `rack`, `column`, `level` (1–3, nur Halle), `row`, `number`, `has_cover`, `status` (`free`, `occupied`, `reserved`, `blocked`), `qr_code` |
| `vehicle_movements` | Lückenlose Bewegungshistorie | `booking_id`, `from_location_id`, `to_location_id`, `moved_by`, `moved_at`, `reason` |
| `protocols` | Annahme und Übergabe | `booking_id`, `type` (`intake`, `handover`), `mileage`, `fuel_level`, `soc_percent`, `damages jsonb`, `signature_media_id`, `pdf_media_id`, `sent_at` |
| `transport_jobs` | Shuttle und Vallet | `type` (`shuttle_slot`, `premium_on_demand`, `vallet`), `direction` (`to_airport`, `from_airport`), `scheduled_at`, `driver_id`, `status` |
| `transport_passengers` | Buchungen pro Shuttle-Fahrt | `transport_job_id`, `booking_id`, `persons` |
| `booking_history` | Änderungslog (Umbuchungen, Leistungen) | `booking_id`, `changed_fields jsonb`, `source`, `changed_at` |
| `settings` | Betriebsparameter | Shuttle-Betriebszeiten, Takt, Mail-Vorlagen |

Aktueller Ort eines Fahrzeugs = letzter Eintrag in `vehicle_movements` (zusätzlich `bookings.current_location_id` als denormalisiertes Feld, per Trigger gepflegt).

**Status-Flow `bookings.status`:**
`booked → arrived → stored → in_service → ready → in_transit → completed` sowie `cancelled`.

Beim Anlegen einer Buchung erzeugt ein Trigger automatisch Aufgaben: Grundreinigung (immer) plus je gebuchter Leistung eine Aufgabe. Sind alle Aufgaben `done`, wechselt der Status auf `ready`.

**Schlüssel (geändert durch Issue #16, 09.10.2026):** Keine Tabelle `keys`. Jeder Stellplatz in Halle und Außenfläche (`area` in `hall`, `outdoor_a`, `outdoor_b`, zusammen 120) hat genau ein Schlüsselfach, Fach-Code = `locations.code`. Die App erfasst keine Schlüsselbewegungen. Eine eigene Schlüsseltabelle ist auf später verschoben.

## 4. Buchungsschnittstelle (Adapter)

Das Buchungsportal steht noch nicht fest. Umsetzung:

- Ordner `src/booking-adapters/` bzw. Edge Function `booking-sync`, Interface `BookingAdapter` mit `normalize(raw) → BookingInput`.
- Erste Implementierung: **manueller Import** (CSV/Excel-Upload, Mapping-Dialog) und **manuelles Anlegen** im UI.
- Später: Webhook- oder API-Adapter, sobald das Portal bekannt ist.
- Idempotenz über `(source, external_ref)` als Unique-Key.
- **Umbuchungen:** Gleiche `external_ref` mit geänderten Daten → Update der Buchung, Eintrag in `booking_history`, Aufgaben für neu gebuchte Leistungen anlegen, stornierte Leistungen auf `cancelled` setzen (nicht löschen). Ändert sich `end_at` bei einem Hallen-Fahrzeug, Regalprüfung neu auslösen (Abschnitt 5).

## 5. Regal-Logik Halle (abhängig, 3 Ebenen)

Regeln pro Spalte (E1 unten, E3 oben):

- Auslagern nur von unten nach oben. Ein Fahrzeug auf E2 kommt nur raus, wenn E1 leer ist.
- Einlagern nur von oben nach unten. Auf E3 kann nur eingelagert werden, wenn E1 und E2 leer sind.
- Sollreihenfolge: `end_at(E1) ≤ end_at(E2) ≤ end_at(E3)`.

Funktionen (als Postgres-Funktion oder Edge Function, mit Unit-Tests):

1. `suggest_hall_location(booking_id)`: schlägt einen Platz vor, der die Regeln einhält. Bevorzugt Spalten, in denen die Reihenfolge ohne Umsetzen passt. Gibt bei Bedarf einen Pufferplatz zurück.
2. `check_column(rack, column)`: prüft die Reihenfolge und liefert Konflikte.
3. Bei Konflikt: automatische Aufgabe `relocate` mit `due_at` vor der früheren Abholung, plus Anzeige der nötigen Anzahl Umsetzvorgänge. Die Aufgabe enthält den Hinweis „Schlüssel mitnehmen: Fach [alt] → Fach [neu]“; beim Umsetzen nennt die App das neue Fach.
4. Freie Plätze mit belegter Ebene darunter werden als „nur mit Umsetzen" markiert (Status `blocked`, berechnet, nicht manuell).

Aufbereitung möglichst vor dem Einlagern einplanen, da Arbeiten an E2/E3-Fahrzeugen Umsetzvorgänge kosten. Die App weist beim Einlagern darauf hin, wenn noch offene Aufgaben bestehen.

## 6. Aktualisierungs-Flow (App-Updates)

Ziel: Neue Versionen erreichen alle Tablets zuverlässig, ohne Datenverlust während laufender Protokolle.

1. `vite-plugin-pwa` mit `registerType: 'prompt'` (kein automatisches Neuladen).
2. Beim Build wird `public/version.json` mit `{ "version": "<package.json version>", "buildTime": "<ISO>" }` erzeugt.
3. Die App prüft beim Start, beim Zurückkehren in den Vordergrund (`visibilitychange`) und alle 10 Minuten, ob ein neuer Service Worker wartet bzw. `version.json` eine höhere Version meldet.
4. Liegt ein Update vor: nicht-blockierendes Banner „Neue Version X.Y.Z verfügbar – Aktualisieren", mit Link zu den Änderungen aus `CHANGELOG.md`.
5. Während ein Protokoll, eine Unterschrift oder ein Check-in offen ist, wird das Update zurückgehalten. Das Banner zeigt dann „Nach Abschluss aktualisieren". Formularentwürfe werden vorher in IndexedDB gesichert und nach dem Neuladen wiederhergestellt.
6. Bei `major`-Versionen (Schemaänderung) ist das Update Pflicht: Banner wird zum Dialog, Weiterarbeiten erst nach Aktualisierung.
7. Supabase-Migrationen müssen abwärtskompatibel mit der vorherigen App-Version sein (erst Spalten hinzufügen, später entfernen), damit Tablets mit alter Version bis zum Update weiterarbeiten.
8. Aktuelle Version sichtbar in den Einstellungen und im Footer.

## 7. Ansichten

Navigation als Seitenleiste (Tablet) bzw. Bottom-Bar (Smartphone), angelehnt an ADE Fleet Manager:

- **Heute:** Ankünfte und Abholungen des Tages als Zeitleiste, offene Aufgaben, Umsetz-Konflikte, Kapazität Halle/Außen.
- **Lageplan:** Tabs Halle und Außen. Halle als Regalraster (Spalten R1–Rn, Ebenen E3 oben bis E1 unten), Außen als Reihen mit Platznummern. Farbe nach Abholdatum (heute, morgen, diese Woche, später, frei, gesperrt). Tippen öffnet rechts das Detailpanel. Referenz: Design-Mockup „Park & Fly – Lageplan Tablet".
- **Fahrzeuge:** Liste mit Filtern (Bereich, Status, offene Leistungen, Abholdatum), Suche nach Kennzeichen.
- **Aufgaben:** Kanban `offen / in Arbeit / erledigt`, filterbar nach Leistungsart, mit Fotos.
- **Shuttle/Vallet:** Stündliche Slots innerhalb der Betriebszeiten für Standardkunden, einzelne Aufträge für Premium/Vallet. Fahreransicht reduziert auf Zeit, Ort, Kennzeichen, Personen.
- **Fahrzeug-Detail:** Stammdaten, Ort, Schlüssel, Leistungen mit Fortschritt, Protokolle, Bewegungshistorie, Buchungshistorie.
- **Einstellungen:** Leistungskatalog, Stellplätze/QR-Codes, Shuttle-Betriebszeiten, Mail-Vorlagen, App-Version.

## 8. Ein- und Auschecken

- QR-Code an jedem Stellplatz und Schlüsselfach (gleicher Code). Ablauf Einparken: Stellplatz bestätigen (QR scannen oder aus der Liste wählen) → Fahrzeug zuordnen → bestätigen. Kein Schlüssel-Scan.
- Der Schlüssel liegt im Fach des Stellplatzes. Zur Aufbereitung, zum Ladeplatz, in den Puffer oder unterwegs geht er mit dem Fahrzeug und kommt danach ins Fach des neuen Stellplatzes.
- Jede Bewegung schreibt `vehicle_movements`. Zielorte beim Auschecken: Aufbereitung, Ladeplatz, Übergabe, Vallet unterwegs, anderer Stellplatz.
- In der Halle wird vor dem Einchecken `suggest_hall_location` angezeigt. Abweichungen sind erlaubt, erzeugen aber eine Warnung.

## 9. Protokolle

- Annahme und Übergabe, jeweils mit Kundenunterschrift (Signature-Pad, als PNG über den Media-Service aus Abschnitt 11).
- Inhalte: Kilometerstand, Tankstand bzw. Akkustand, Schäden (Fotos, Position), Bemerkungen.
- Übergabeprotokoll zeigt den Vergleich zur Annahme.
- PDF im Layout von Vehicle Protocol Pro V2, Versand per E-Mail an den Kunden (Edge Function).

## 10. E-Mails

Vorlagen in `settings`, Versand über Edge Function. Trigger vorbereiten, aber einzeln aktivierbar, da noch nicht final entschieden:
- Protokoll nach Annahme / Übergabe (aktiv)
- Aufbereitung abgeschlossen, mit Fotos (optional). Fotos als verkleinerte Vorschaubilder bzw. zeitlich begrenzte Links einbinden, keine Vollbilder als Anhang.
- Erinnerung vor Abholung für Rückfragen (optional)

## 11. Skalierung & Kosten

Ziel: Speicher- und Transferkosten bleiben auch bei vielen Fahrzeugen und Fotos gering. Größter Kostentreiber ist nicht der Speicherplatz, sondern Egress (jedes geladene Bild). Richtwert: ~500 Fahrzeuge/Monat mit ~30 Fotos ergeben komprimiert ~4–5 GB/Monat, unkomprimiert mehr als das Zehnfache.

### 11.1 Bild-Pipeline (im Browser, vor dem Upload)
- Jedes Foto wird clientseitig verarbeitet (z. B. Canvas / `createImageBitmap`, in einem Web Worker):
  - **Vollbild:** WebP, längste Kante max. 1600 px, Qualität ~0.75, Ziel ~250 KB
  - **Thumbnail:** WebP, längste Kante 320 px, Ziel ~20 KB
  - EXIF-Ausrichtung berücksichtigen, übrige EXIF-Daten (GPS) entfernen
- Originale in Kameraauflösung werden nie hochgeladen.
- Unterschriften als PNG mit reduzierter Größe, PDFs serverseitig mit komprimierten Bildern erzeugen.

### 11.2 Upload und Auslieferung
- Upload direkt vom Gerät in den Storage per **Signed Upload URL** (Edge Function `media-sign`). Keine Datei läuft über Fly.io oder eine eigene API.
- Private Buckets, Auslieferung nur über kurzlebige Signed URLs.
- **Listen, Lageplan, Aufgabenkarten, Detailansichten laden nur `thumb_path`.** Vollbild erst beim Antippen (Lightbox).
- Lazy Loading (`loading="lazy"`) und HTTP-Caching (`cache-control` mit langer Laufzeit, Dateinamen unveränderlich, z. B. `<uuid>.webp`).
- Offline-Queue: Fotos werden in IndexedDB zwischengespeichert und im Hintergrund hochgeladen, sobald Netz da ist. Upload-Status in der UI sichtbar.

### 11.3 Storage-Abstraktion
- Einziger Zugriffspunkt ist `src/lib/media/` mit Interface `MediaStore` (`getUploadUrl`, `getViewUrl`, `delete`, `archive`).
- Erste Implementierung: Supabase Storage. Die Datenbank speichert `provider + bucket + path`, nie eine fertige URL.
- Ein späterer Wechsel auf ein S3-kompatibles Object Storage ohne Egress-Gebühren (z. B. Cloudflare R2) darf nur eine neue `MediaStore`-Implementierung plus Migrationsskript erfordern, keine Änderungen in UI-Komponenten.

### 11.4 Aufbewahrung
- `media.retention_until` wird bei Abschluss einer Buchung gesetzt (Frist konfigurierbar in `settings`, Wert wird noch rechtlich geklärt).
- Täglicher Job (Supabase Cron / `pg_cron` + Edge Function): Vollbilder nach Fristablauf löschen oder in Archiv-Bucket verschieben. PDF-Protokolle und Thumbnails bleiben erhalten.
- Löschungen werden protokolliert.

### 11.5 Datenbank
- Keine Binärdaten und kein Base64 in Postgres.
- Indizes mindestens auf `bookings(status, end_at)`, `bookings(plate)`, `bookings(source, external_ref)` unique, `locations(area, status)`, `tasks(status, due_at)`, `vehicle_movements(booking_id, moved_at)`, `media(booking_id)`, `media(retention_until)`.
- Alle Listen mit serverseitiger Paginierung (Keyset/Cursor, nicht `OFFSET` bei großen Tabellen).
- `vehicle_movements` und `booking_history` wachsen am schnellsten: so anlegen, dass sie später nach Jahr archiviert oder partitioniert werden können.
- Realtime nur auf `locations`, `tasks`, `transport_jobs` und mit Filtern (z. B. nur offene Aufgaben), nicht auf ganze Tabellen.

### 11.6 Kostenkontrolle
- Supabase Spend Cap aktiv lassen, Nutzungsalarme für Storage und Egress einrichten.
- Einstellungen → App & Version zeigt Speicherverbrauch (Summe `media.bytes`) und Anzahl Dateien.
- Upload-Schutz: max. Dateigröße pro Upload serverseitig begrenzen, Rate-Limit pro Gerät, damit ein Fehler keine Kostenexplosion auslöst.

## 12. Umsetzungsreihenfolge

1. Projekt-Setup, PWA, Aktualisierungs-Flow, Versionsanzeige, CHANGELOG
2. Datenmodell + Migrationen + Seed (Bereiche, Stellplätze, Leistungskatalog), inkl. Indizes
3. Media-Service: Bild-Pipeline, Signed Uploads, Thumbnails, Offline-Queue (Abschnitt 11)
4. Buchungen manuell anlegen + CSV-Import über Adapter
5. Lageplan Halle/Außen mit Ein-/Auschecken und Bewegungshistorie
6. Regal-Logik mit Vorschlag, Konfliktprüfung und Umsetz-Aufgaben (mit Tests)
7. Aufgaben/Leistungen mit Fotos und automatischem Status „bereit"
8. Protokolle mit Unterschrift, PDF und Mailversand
9. Shuttle/Vallet-Planung
10. Heute-Dashboard und Kapazitätsanzeige
11. Aufbewahrungs-Job und Kostenanzeige

Nach jedem Schritt: Version erhöhen, CHANGELOG ergänzen, Build prüfen.

## 13. Offene Punkte (noch nicht entscheiden, nur vorbereiten)

- Buchungsportal und Art der Schnittstelle
- Finaler Leistungskatalog und Preise
- Kundenbenachrichtigungen (welche automatisch)
- Kundenportal (Token ist vorbereitet)
- Abrechnung: App führt aktuell nur „gebucht ja/nein" plus Preis zum Buchungszeitpunkt
- Aufbewahrungsfrist für Fotos und Protokolle (rechtlich klären, Wert kommt in `settings`)
- Ob und wann Storage auf ein Object Storage ohne Egress-Gebühren umzieht (erst bei Bedarf)
