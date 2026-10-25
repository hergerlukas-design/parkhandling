# Änderungsprotokoll

Alle nennenswerten Änderungen am Park & Fly Manager. Versionierung nach [SemVer](https://semver.org/lang/de/):
`patch` = Fehlerbehebung, `minor` = neue Funktion, `major` = Breaking Change (Pflicht-Update).

## 0.26.1 – 25.10.2026

### Behoben
- Auslieferung auf Fly.io schlug seit 0.25.0 fehl: Der Docker-Build schloss den ganzen Ordner `supabase` aus, das Frontend importiert aber `supabase/functions/_shared/webpush.ts` (Web Push). Ausgeschlossen werden jetzt nur Migrationen, Tests und Seeds

## 0.26.0 – 25.10.2026

### Neu
- Hol- & Bringservice in der Dispo (*Shuttle*): Übergabe am Terminal
  - je Fahrzeug zwei Aufträge: „Übernahme am Terminal“ zur Ankunftszeit und „Rückgabe am Terminal“ 30 min nach der Landung
  - eigene Aufträge statt Sammel-Slot, ohne Platzanzeige; „Zeit ändern“ statt „Umsetzen“
  - Fahreransicht zeigt „Terminal: Auto übernehmen → Platz“ bzw. „Platz → Terminal: Auto übergeben“
  - Umbuchung, Storno und Wechsel zwischen Shuttle und Hol- & Bring planen automatisch neu
- Fahrzeug-Detail zeigt Übernahme und Rückgabe am Terminal
- Terminal aus der Flugnummer (Lufthansa-Gruppe und Star Alliance → T2, sonst T1), angezeigt bei jedem Fahrgast und als Treffpunkt der Hol- & Bring-Aufträge; Zuordnung in den Einstellungen (`airport_terminal_map`)
- Hol- & Bring-Aufträge zeigen, mit welchem Shuttle der Fahrer zum Terminal und wieder zurück fährt

### Datenbank
- Migration `20261025000300_valet_terminal.sql` (additiv): Auftragsart `pickup_delivery`, Einstellungen `valet_return_after_landing_minutes`, `valet_handover_minutes`, `shuttle_transfer_minutes`, `airport_terminal_map`, Funktionen `terminal_for_flight`, `shuttle_slot_before`, `valet_driver_shuttle_at`, `transport_board` mit Terminal und Fahrer-Shuttle, `plan_booking_transport` und `move_transport_passenger` erweitert; bestehende Hol- & Bring-Buchungen werden eingeplant

## 0.25.0 – 25.10.2026

### Neu
- Push-Benachrichtigungen für das Personal, auch bei geschlossener App (*Einstellungen → Benachrichtigungen auf diesem Gerät*)
  - Ereignisse: neue Buchung, Umbuchung/Storno, Import prüfen (nur Admins), Umsetzen nötig (Regal-Konflikt und Erinnerung vor Fälligkeit), Ankunft bald, Abholung bald, Fahrzeug bereit, Shuttle fällig (an den eingeteilten Fahrer, sonst an alle)
  - Pro Gerät: Gerätename, Ereignisse einzeln an/aus, „Testbenachrichtigung senden“, Abmelden
  - Tippen auf die Benachrichtigung öffnet die passende Ansicht (Fahrzeug, Aufgaben, Shuttle)
  - Bei geöffneter App erscheint ein Hinweis unten statt einer Systembenachrichtigung
  - Wer eine Buchung selbst anlegt oder ändert, wird darüber nicht benachrichtigt
  - Inhalte ohne Kundennamen und Kontaktdaten (nur Kennzeichen, Zeiten, Platz, Status)
  - iPhone/iPad: Hinweis „Zum Home-Bildschirm hinzufügen“, wenn die App nicht installiert ist
- Admin: Ereignisse global an/aus, Empfänger (alle / nur Admins), Vorlaufzeiten (Ankunft, Abholung, Umsetzen, Shuttle), angemeldete Geräte (abmelden/aktivieren) und die letzten 50 Meldungen mit Status
- App-Updates werden weiterhin nur per Banner gemeldet, nicht per Push

### Technik
- Web Push ohne Drittanbieter: Verschlüsselung (RFC 8291) und VAPID (RFC 8292) mit WebCrypto in `supabase/functions/_shared/webpush.ts`, gegengeprüft mit `http_ece`/`web-push`
- Edge Function `push-send` (Aufruf nur aus der Datenbank per Secret-Header); `npm run push:keys` erzeugt die Schlüssel
- Service Worker bindet `push-handler.js` per `importScripts` ein; der Aktualisierungs-Flow (Prompt, Zurückhalten bei offenem Protokoll) ist unverändert

### Datenbank
- Migration `20261025000200_push_notifications.sql` (additiv): Tabellen `push_subscriptions` und `notifications` (Outbox mit `dedupe_key`, RLS), Einstellungen `notifications` und `push_vapid_public_key`, Trigger auf Buchungen, Importen und Umsetz-Aufgaben, Funktionen `enqueue_notification`, `enqueue_due_notifications`, `dispatch_push`, `claim_push_batch`, `finish_push`, `save_push_subscription`, `set_push_events`, `remove_push_subscription`, `send_test_push`; Cron-Jobs `push-due-notifications` (5 min) und `push-dispatch` (1 min); Demo-Daten lösen keine Meldungen aus

## 0.24.0 – 25.10.2026

### Neu
- Shuttle-Dispo (*Shuttle* in der Navigation, am Smartphone in der unteren Leiste)
  - Fahrten entstehen automatisch aus Buchungen mit Shuttle: Hinfahrt im nächsten Slot nach Ankunft am Platz (+15 min Annahme), Rückfahrt im nächsten Slot nach der Landung (+30 min Gepäck)
  - Halle (Premium) und Zeiten außerhalb der Betriebszeiten (05:00–23:00) werden Fahrten „auf Abruf“ zur genauen Uhrzeit
  - Umbuchung, Storno, geänderte Personenzahl oder geänderte Einstellungen planen automatisch neu; leere Fahrten verschwinden
  - Tagesansicht Heute/Morgen mit Vor/Zurück, getrennt nach „Zum Flughafen“ und „Vom Flughafen“
  - Pro Fahrt: Uhrzeit, Personen/Plätze mit Warnung „überbucht“, Fahrer einteilen, Losfahren → Erledigt
  - Pro Fahrgast: Kennzeichen (zum Fahrzeug), Personen, Flugnummer, Ankunft bzw. Landung, Wartezeit am Terminal, Anrufen
  - Umsetzen in eine andere Fahrt oder eine neue Fahrt auf Abruf; „von Hand ↺“ gibt den Fahrgast wieder an die Automatik
  - Fahreransicht: nur Uhrzeit, Route, Kennzeichen, Personen und der nächste Schritt; „Nur meine Fahrten“
- Fahrzeug-Detail zeigt die Shuttle-Fahrten der Buchung mit Link in die Dispo
- Dashboard warnt, wenn ein Shuttle heute oder morgen überbucht ist

### Datenbank
- Migration `20261025000100_shuttle_planning.sql` (additiv): Spalte `transport_passengers.manual`, Einstellungen `shuttle_checkin_minutes` und `shuttle_pickup_after_landing_minutes`, Funktionen `plan_booking_transport`, `shuttle_slot_at`, `replan_transport`, `move_transport_passenger`, `reset_transport_passenger`, `transport_board`, `booking_transport`, `list_drivers`, Trigger auf Buchungen und Einstellungen; bestehende Shuttle-Buchungen werden eingeplant

## 0.23.0 – 22.10.2026

### Neu
- Parkos-Mail importieren (*Fahrzeuge → Parkos-Mail*): Mailtext einfügen oder `.eml`/`.html` hochladen, Vorschau mit allen Feldern und Hinweisen, dann „Buchung übernehmen“
  - liest Reservierungsnummer, Name, Telefon (nicht die Betriebsnummer aus dem Abschnitt „Parkplatz“), Sprache, Fahrzeug, Kennzeichen, Personen, Parkform, Transfer, Flüge, Ankunft, Landung, Preis, Auszahlung und „im Voraus bezahlt“
  - Abholung = Landung + Puffer aus den Einstellungen (60 min), korrekt über die Zeitumstellung
  - Kennzeichen „M MM 3839“ wird zu „M-MM 3839“; nicht eindeutige Kennzeichen werden markiert
  - erneuter Import derselben Reservierung aktualisiert statt zu duplizieren (Änderungen in der Buchungshistorie)
  - Umbuchungen, Stornos, unbekannte Mails, unbekannte Parkformen und fremde Absender werden nicht automatisch übernommen, sondern zur Prüfung abgelegt
- Prüfliste „n prüfen“ in der Fahrzeugliste: eingelesene Mails mit Status, Rohtext und „Als erledigt markieren“
- Fahrzeugliste: Hinweis „Parkos“ und „prüfen“ am Kennzeichen; Fahrzeug-Detail zeigt Auszahlung und Import-Hinweise
- Buchungsformular nutzt den Puffer aus den Einstellungen

### Geändert
- „Anzahl Tage“ zählt Kalendertage inklusive (wie Parkos), nicht mehr angefangene 24-Stunden-Blöcke

### Datenbank
- Migration `20261022100000_parkos_mail_import.sql`: Tabelle `booking_imports` (Rohtext, Parse-Ergebnis, Status, RLS), Spalten `bookings.portal_payout` und `bookings.import_flags`, Einstellungen `return_buffer_minutes` und `parkos_product_map`, Funktionen `import_booking_mail` und `resolve_booking_import`; `upsert_booking` auch für den Service-Zugang (späterer IMAP-Abruf); Fahrzeugliste mit neuen Spalten
- Gemeinsamer Unterbau für den späteren automatischen IMAP-Abruf: derselbe Parser (ohne Browser-Funktionen) und dieselbe Datenbankfunktion

## 0.22.0 – 22.10.2026

### Neu
- Buchungen haben Flug- und Transferangaben: Flug hin, Flug zurück, Landung Rückflug, Sprache, Transfer (erste Quelle: Parkos-Testbuchung #494PHBR)
- Fahrzeug-Detail zeigt Flüge, Landung, Transfer und Sprache; Quelle „Parkos“ wird benannt
- Formular „Buchung anlegen/bearbeiten“: neuer Abschnitt „Flug & Transfer“. Ist eine Landung eingetragen, schlägt die App die Abholung am Platz vor (Landung + 60 min) und übernimmt sie auf Tippen
- Flugnummern werden vereinheitlicht („lh 123“ → „LH123“), Änderungen an den neuen Feldern erscheinen in der Buchungshistorie

### Datenbank
- Migration `20261022083159_booking_flight_fields.sql`: Spalten `flight_out`, `flight_return`, `return_flight_at`, `customer_language`, `transfer_note` (additiv, bereits auf Prod und Staging angewendet)
- Migration `20261022083534_booking_flight_fields_upsert.sql`: `upsert_booking` speichert die neuen Felder, `after_booking_update_history` protokolliert sie

## 0.21.0 – 17.10.2026

### Neu
- Einstellungen → „Stellplätze: Halle & Außenfläche“ (nur Admin): Größe per +/− einstellen
  - Halle: Regale × Ebenen, z. B. 4 Regale × 2 Ebenen (1–30 Regale, 1–5 Ebenen)
  - Außen A (mit Plane) und Außen B (ohne Plane): Reihen × Plätze je Reihe (1–9 Reihen, 1–99 Plätze)
- Vorschau zeigt, welche Plätze dazukommen oder wegfallen; steht auf einem wegfallenden Platz ein Fahrzeug oder ist er reserviert, ist die Umstellung gesperrt, bis umgesetzt ist
- Wegfallende Plätze werden deaktiviert, nicht gelöscht: sie verschwinden aus Lageplan, Platzvorschlägen und Etiketten und kommen beim Vergrößern mit demselben QR-Code zurück
- Lageplan Halle zeigt so viele Ebenen, wie eingestellt sind (vorher fest E1–E3)

### Datenbank
- Funktionen `set_hall_layout(Regale, Ebenen)` und `set_outdoor_layout(Bereich, Reihen, Plätze)`, Ebenen 1–5 erlaubt. Migration `20261017000100_site_layout.sql`

## 0.20.1 – 11.10.2026

### Geändert
- Übergabeprotokoll: nur noch ein Feld „Kilometerstand“, vorbelegt mit dem Stand der Annahme; darunter „Annahme: … km · +… km“ (Hinweis „bitte prüfen“ bei mehr als 5 km oder weniger als bei der Annahme). „Annahme-Stand übernehmen“ setzt den Stand zurück

## 0.20.0 – 11.10.2026

### Geändert
- Übergabeprotokoll: Kilometerstand der Annahme wird übernommen und ausgegraut angezeigt; erfasst werden nur die seither gefahrenen Kilometer („+ seither gefahren“), der KM-Stand der Übergabe wird daraus berechnet. Hinweis ab mehr als 5 km, bei Abweichung (z. B. Tippfehler in der Annahme) lässt sich der Stand weiterhin direkt eingeben

## 0.19.0 – 09.10.2026

### Geändert
- Auschecken/Umsetzen: Ziele „Aufbereitung 1/2“ und „Ladeplatz 1/2“ entfernt
- Auschecken in die Übergabezone fragt danach „Übergabeprotokoll jetzt erstellen?“ und öffnet auf Wunsch direkt das Übergabeprotokoll
- „Übergeben (verlässt das Gelände)“ öffnet das Übergabeprotokoll direkt bei den Unterschriften (veralteter Hinweis „folgt in Schritt 10“ entfernt)
- Übergabeprotokoll in der Übergabezone vorbereiten: „Entwurf speichern – Unterschrift bei Übergabe“ sichert den Entwurf und führt zurück zum Fahrzeug
- „Abschließen & Fahrzeug übergeben“: mit dem Abschluss des Übergabeprotokolls wird das Fahrzeug ausgecheckt und die Buchung abgeschlossen; „Fahrzeug übergeben“ bleibt als Rückfall, falls das Auschecken fehlschlägt
- Aufgabe: Popup schließt sich nach Klick auf „Erledigt“ automatisch

## 0.18.0 – 09.10.2026

### Geändert (Issue #16)
- Schlüsselkonzept: 1 Schlüsselfach pro Stellplatz, Fach-Code = Stellplatz-Code. Die App erfasst keine Schlüssel. Hinweise lauten jetzt „Schlüssel ins Fach R1-E1 legen“, „Schlüssel mitnehmen: Fach R1-E1 → Fach R4-E2“ bzw. „Schlüssel aus Fach R1-E1 nehmen, er geht mit dem Fahrzeug“ (Aufbereitung, Ladeplatz, Puffer, unterwegs)
- Einparken vom Stellplatz aus: Scan eines freien Stellplatzes öffnet das Einchecken mit diesem Platz, dort Fahrzeug zuordnen und bestätigen. Scan eines belegten Platzes öffnet das Fahrzeug
- Fahrzeugliste: Spalte „Stellplatz / Fach“; steht das Fahrzeug nicht auf einem Stellplatz, steht dort der Ort (z. B. „in Aufbereitung“)
- Umsetz-Aufgaben enthalten „Schlüssel mitnehmen: Fach [alt] → Fach des neuen Stellplatzes“
- Einstellungen → Betrieb → „Stellplätze/QR-Codes“: Fachliste mit Code, Stellplatz, Bereich und Fahrzeug; Etiketten mit QR-Code (`PF-LOC`) für Stellplatz-Schild und Fach. Ersetzt den Druckbogen für Schlüsselanhänger

### Datenbank
- Tabelle `keys` gelöscht, `move_vehicle` erfasst keine Schlüssel mehr (Parameter `p_key_code` wird ignoriert, ältere Tablets funktionieren weiter). Migration `20261009000300_key_slot_per_location.sql`

## 0.17.1 – 09.10.2026

### Behoben
- Protokoll: Schlägt das Speichern in der Datenbank fehl, erscheint eine Meldung mit dem Grund und „Erneut versuchen“. Bisher blieb nur der Hinweis „Entwurf auf dem Gerät gesichert“ stehen (Issue #9, Befund 2)
- „Entwurf gespeichert“ erscheint nur, wenn die Datenbank den Stand bestätigt hat. Offline zeigt die Kopfzeile „Offline: Entwurf auf dem Gerät gesichert“
- Schadenskarte: Nach „Speichern“ zeigt die Karte „✓ Schaden gespeichert“, sobald die Datenbank den Stand bestätigt hat (bzw. „Offline“ oder „Nicht gespeichert“)

## 0.17.0 – 09.10.2026

### Geändert
- Schlüsselanhänger tragen den Stellplatz-Code: Jeder Platz in Halle und Außenfläche hat einen fest gedruckten Anhänger (z. B. R1-E1) mit QR-Code `PF-KEY:R1-E1`. Die Schlüsselfächer K-001 bis K-150 entfallen
- Einchecken ohne eigenen Schlüssel-Schritt. Nach dem Einlagern zeigt die App „Schlüssel an den Anhänger R1-E1 hängen“
- Umsetzen und Auschecken zeigen, was mit dem Schlüssel zu tun ist (umhängen, abnehmen, übergeben)
- Fahrzeugdetail zeigt als Schlüssel den Anhänger des aktuellen Platzes bzw. „beim Fahrzeug“
- Scan eines Schlüsselanhängers öffnet das Fahrzeug auf diesem Platz, bei freiem Platz den Lageplan

### Neu
- Druckbogen „Schlüsselanhänger drucken“ (Einstellungen → Betrieb): ein Etikett je Stellplatz mit Code und QR-Code, 3 × 7 Etiketten (63,5 × 38,1 mm) je A4-Bogen, filterbar nach Bereich

## 0.16.0 – 09.10.2026

### Neu
- Ladestand im Annahme- und Übergabeprotokoll wieder erfassbar: Textfeld in Prozent (1–100). Elektro erfasst den Ladestand, Hybrid Tankstand-Slider und Ladestand, Verbrenner nur den Tankstand
- Ladestand ist Pflicht zum Abschließen (Elektro und Hybrid), erscheint im Vergleich mit der Annahme und im PDF als „80 %“ (Feld „Batterie“)

### Datenbank
- Neue Spalte `protocols.charge_level` (`smallint`, Prozent 1–100), Migrationen `20261009000100_charge_level.sql` und `20261009000200_charge_level_percent.sql` (nur additiv). Die bis 0.14.0 erfassten Akkustände in Prozent sind nicht wiederherstellbar

## 0.15.1 – 09.10.2026

### Neu
- Personal-Verwaltung in den Einstellungen (nur Admins): Liste mit Rolle und Status, Rolle ändern, aktivieren und deaktivieren
- Konten nur per Admin-Einladung: Edge Function `user-invite` versendet den Einladungslink, der Eingeladene vergibt sein Passwort auf `/passwort` (mindestens 12 Zeichen)
- Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden (Datenbank-Trigger `guard_last_admin`)

### Geändert
- Eingeladene Personen müssen beim ersten Login ein eigenes Passwort festlegen, bevor sie die App nutzen
- Profile speichern die E-Mail-Adresse; Profile werden nicht mehr gelöscht, nur deaktiviert

## 0.14.0 – 08.10.2026

### Neu
- Dashboard (vormals „Heute“) mit Datumsauswahl: Heute, Morgen und Woche, Vor- und Zurück-Navigation über Tage bzw. Wochen. Warnungen für heute und morgen bleiben immer sichtbar
- Schadensfotos in hoher Auflösung (längste Kante 2400 px, WebP 0,85); Lightbox mit Pinch-to-Zoom und Doppeltippen für alle Fotos
- Tankstand als Slider mit 8 Segmenten (Verbrenner und Hybrid)

### Geändert
- Vallet entfällt, Leistung heißt „Hol- & Bringservice“ (`return_mode` `pickup_delivery`). Bestehende Buchungen werden umgeschrieben; Vallet-Fahrten aus dem Shuttle-Bereich entfernt
- Kilometerstand mit einer Nachkommastelle: Eingabe mit Dezimalkomma (z. B. 84213,5), Speicherung mit Punkt
- Akkustand entfällt im Protokoll und im PDF
- Schadenskarte mit Speichern-Button pro Eintrag. Ungespeicherte Schäden blockieren das Abschließen; bereits hochgeladene Fotos bleiben erhalten
- Stellplatz-Label im Lageplan zeigt das Abholdatum („Abholung dd.mm.“)
- Im PDF erscheint der Tankstand als „x/8“, der Kilometerstand mit Tausendertrennzeichen (z. B. „84.213,5 km“)

### Behoben
- Bestehende Tankstände (10/25/50/75/100 %) wurden beim Migrieren auf Segmente umgerechnet (1/2/4/6/8)

## 0.13.2 – 08.10.2026

### Behoben
- Protokoll-PDFs mit vielen Fotos passen immer unter das Upload-Limit von 1,5 MB: Ist das PDF zu groß, werden die Fotos darin stufenweise kleiner gerechnet (bisher wurde ein PDF mit z. B. 23 Fotos 1,7 MB groß und vom Server abgelehnt)

## 0.13.1 – 08.10.2026

### Behoben
- PDF: Fehlender Tank- oder Akkustand erscheint als „– %“ statt „? %“
- PDF: Anführungszeichen („ “ ’), Gedankenstriche, € und … in Bemerkungen und Schadensbeschreibungen werden nicht mehr zu „?“; nicht darstellbare Zeichen werden lesbar ersetzt (→ wird ->, č wird c), Emojis entfallen
- PDF: Beschriftungen mit echten Umlauten („Erfasste Schäden“, „Fahrzeug-Übergabeprotokoll“, „Vorläufiger Entwurf“)

## 0.13.0 – 08.10.2026

### Geändert
- Protokolle ohne Checkliste (Sauberkeit/Zubehör): Die Karte entfällt im Formular, der Abschnitt entfällt im PDF; die folgenden Abschnitte rücken nach
- Schäden werden mit einem Freitext beschrieben statt mit Art und Intensität; das PDF zeigt eine Spalte „Beschreibung“. Ältere Einträge werden automatisch übernommen („Kratzer, Mittel“)
- Vergleich zur Annahme: Als neu gilt ein Schaden an einer Position, an der bei der Annahme keiner erfasst war

### Behoben
- PDF: Mehrzeilige Bemerkungen ragen nicht mehr aus ihrem Rahmen

## 0.12.0 – 08.10.2026

### Neu
- Passender Stellplatz direkt nach der Annahme: Das abgeschlossene Annahmeprotokoll zeigt den empfohlenen Platz mit Begründung, „Einchecken auf …“ übernimmt ihn ins Einchecken
- Einchecken zeigt den empfohlenen Platz schon beim Schlüssel-Schritt und wählt ihn vor

## 0.11.0 – 07.10.2026

### Neu
- Schadenskarte aus dem ADE Fleet Manager in Annahme- und Übergabeprotokoll: Position wird in der Fahrzeuggrafik (Oben, Vorne, Hinten, Links, Rechts, Innenraum) angetippt statt aus einer Liste gewählt; Positionen weiterer Schäden sind rot markiert, Reiter mit Schäden tragen einen roten Punkt
- Abgeschlossene Protokolle zeigen die Grafik nur zur Ansicht

## 0.10.3 – 06.10.2026

### Intern
- Automatisches Deployment: Jeder Merge auf `main` wird geprüft (Typecheck, Tests, Build) und auf Fly.io ausgeliefert (GitHub-Workflow, Secret `FLY_API_TOKEN`)

## 0.10.2 – 06.10.2026

### Dokumentation
- Mail-Dienst als zurückgestellt vermerkt (ANNAHMEN.md); Protokolle und PDFs funktionieren ohne ihn

## 0.10.1 – 06.10.2026

### Dokumentation
- README vollständig: Einrichtung (Umgebungsvariablen, Migrationen, Seed- und Demo-Befehl, Konten freischalten, Edge Functions und Mail-Secrets), Prüfbefehle und Testablauf für die Abnahme von Phase 1

## 0.10.0 – 06.10.2026

### Neu
- Heute-Ansicht nach Klick-Prototyp: Kennzahlen Ankünfte, Abholungen (davon Halle), offene Aufgaben (fällig heute) und Umsetzen nötig
- Ablauf heute: Ankünfte und Abholungen nach Uhrzeit mit Status (erledigt, erwartet, überfällig, bereit, „n offen“), Rückgabeart, Stellplatz, offene Leistungen und Hinweis „Zahlung offen“; Tippen öffnet das Fahrzeug
- „Braucht Aufmerksamkeit“: Abholungen heute/morgen mit offenen Leistungen, Umsetz-Konflikte im Regal, nicht angekommene Anreisen, offene Zahlungen vor Abholung
- Belegung Halle / Außen A / Außen B; Live-Aktualisierung über Realtime und jede Minute
- Fahrzeugliste und Aufgaben-Board lassen sich per Link vorfiltern (`?filter=`)

## 0.9.0 – 06.10.2026

### Neu
- Annahme- und Übergabeprotokoll nach Klick-Prototyp: Basisdaten, Kilometerstand, Tankstand (Res./¼/½/¾/voll) bzw. Akkustand nach Antriebsart, Bedingungen, Checkliste Sauberkeit/Zubehör, Fotos vorne/hinten/links/rechts/Fahrzeugschein, Schäden mit Position, Art, Intensität und Foto, weitere Fotos, Bemerkung
- Unterschrift Kunde und Mitarbeiter per Finger/Stift, als PNG über den Media-Service gespeichert
- Übergabeprotokoll zeigt den Vergleich zur Annahme (KM, Tank/Akku, neue Schäden) und übernimmt FIN und Zubehör
- PDF im Layout der Vorlage aus Vehicle Protocol Pro V2 (fahrzeug-protokolle-v2), wird beim Abschließen erzeugt, gespeichert und kann geteilt bzw. heruntergeladen werden; Vorschau als Entwurf mit Wasserzeichen
- Versand des PDFs per E-Mail über die Edge Function, im Prototyp nur an die Testadresse; Versandstatus wird angezeigt, erneutes Senden möglich
- Entwürfe werden automatisch gesichert (sofort auf dem Gerät, kurz danach in der Datenbank) und nach Neuladen wiederhergestellt; App-Updates warten, solange ein Protokoll offen ist
- Nach der Annahme „Weiter zum Einchecken“, nach der Übergabe „Fahrzeug übergeben“
- Fahrzeug-Detail: Protokolle mit Status, Starten/Fortsetzen/PDF; Verlauf zeigt unterschriebene Protokolle
- Check-in: Schritt „Protokoll“ zeigt, ob das Annahmeprotokoll fehlt, angefangen oder unterschrieben ist

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
