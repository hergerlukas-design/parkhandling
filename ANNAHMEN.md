# ANNAHMEN – Park & Fly Prototyp

Stand: 26.10.2026 · Diese Datei gehört ins Repo-Root und wird bei jeder geklärten Frage aktualisiert.

Legende: **[BELEGT]** = aus Gespräch, Excel-Vorlage oder Nachtrag bestätigt · **[ANNAHME]** = Platzhalter, später anpassen · **[ENTFALLEN]** = nicht mehr Teil des Konzepts

Verbindlich ist `docs/PARK_AND_FLY_Arbeitsanweisung.md`, geändert durch `docs/ARBEITSANWEISUNG_Nachtrag_08-10-2026.md`, `docs/ARBEITSANWEISUNG_Nachtrag_22-10-2026.md` und `docs/ARBEITSANWEISUNG_Nachtrag_25-10-2026.md` (Nachträge haben bei Widersprüchen Vorrang, der jüngere zuerst).

Offene Fragen und bewusst noch nicht umgesetzte Punkte stehen in `OFFENE_FRAGEN.md`.

Alle Werte mit [ANNAHME] liegen als Seed-Daten oder in `settings` und sind ohne Code-Änderung anpassbar.

## Betrieb
- [BELEGT] Standort: Park & Fly Flughafen München
- [BELEGT] Ca. 100–120 Stellplätze, davon ca. 25 Indoor (Premium)
- [BELEGT] Indoor-Regale abhängig, 3 Ebenen; frühe Abholung unten
- [ANNAHME] Halle: 8 Regalspalten × 3 Ebenen = 24 Plätze (R1–R8, E1–E3); Admins stellen die Größe unter Einstellungen → Stellplätze um (1–30 Regale, 1–5 Ebenen)
- [ANNAHME] Außen A (mit Abdeckplane): 2 Reihen × 24 Plätze (A1, A2); umstellbar unter Einstellungen → Stellplätze (1–9 Reihen, 1–99 Plätze je Reihe)
- [ANNAHME] Außen B (ohne Plane): 2 Reihen × 24 Plätze (B1, B2); ebenso umstellbar
- [ANNAHME] Arbeitsorte: Aufbereitung 1, Aufbereitung 2, Ladeplatz 1–2, Pufferzone (3 Plätze), Übergabezone
- [BELEGT] Schlüssel (Issue #16, 0.18.0): 1 Fach pro Stellplatz, Fach-Code = Stellplatz-Code, keine Schlüsselerfassung in der App
- [BELEGT] Zur Aufbereitung (und zu Ladeplatz, Puffer, unterwegs) wandert der Schlüssel mit und kommt danach ins Fach des neuen Stellplatzes (Entscheidung Lukas 09.10.2026)
- [ANNAHME] Umsetzen wird nicht als Schlüsselbewegung erfasst; die Umsetz-Aufgabe nennt das Fach, die App beim Umsetzen das neue Fach
- [BELEGT] Zweitschlüssel: kein eigenes Datenmodell, liegen im selben Fach, Kennzeichen am Anhänger
- [ENTFALLEN] Tresor mit Fächern K-001 bis K-150, Schlüsselanhänger mit Stellplatz-Code (0.17.0) und Tabelle `keys` (gelöscht in 0.18.0)
- [ANNAHME] Platz-Codes: Halle `R<Spalte>-E<Ebene>`, Außen `A1-07`, Arbeitsorte `W-AUF1`, `W-LAD1`, `W-UEB`, Puffer `P-01`; QR-Inhalt `PF-LOC:<Code>` (gilt für Stellplatz-Schild und Schlüsselfach)
- [ANNAHME] Kapazität: Aufbereitung/Ladeplatz/Puffer je 1 Fahrzeug, Übergabezone 6, „Hol- & Bringservice unterwegs“ 50 (Code `T-VAL` unverändert; Bezeichnung seit 0.14.0 ohne „Vallet“)
- [ANNAHME] Spalte `column` aus der Arbeitsanweisung heißt in der DB `rack_column` (SQL-Schlüsselwort)

## Leistungen
- [BELEGT] Leistungsarten laut Excel: Park & Fly, Premium-Stellplatz, Fahrzeugpflege/Aufbereitung, Hol- & Bringservice, Transfer Flughafen, Zusatzleistung
- [BELEGT] Grundreinigung bei jeder Buchung; Aufbereitung in Teilschritten
- [BELEGT] Preise werden derzeit manuell bzw. individuell vereinbart
- [ANNAHME] Leistungs-Codes: GRUND, AUF_INNEN, AUF_AUSSEN, POLITUR, LADEN, TANKEN, SERVICE, ZUSATZ; Teilschritte je Leistung als Checkliste in `services.steps` (z. B. Aufbereitung innen: Saugen, Kunststoffe, Scheiben, Fußmatten)
- [ANNAHME] Katalog: Grundreinigung (Standard), Aufbereitung innen, Aufbereitung außen, Politur, Laden, Tanken, Servicearbeiten, Zusatzleistung (Freitext)
- [ANNAHME] Preise im Katalog leer (`null`); Gesamtpreis pro Buchung manuell eintragbar

## Laden (26.10.2026)
- [BELEGT] Ladesäulen von Kempower (mobile Säule mit RFID-Leser), Verwaltung über ChargEye; REST-API vorhanden (docs.kempower.io)
- [BELEGT] Ladepunkte sind privat, nicht öffentlich (Lukas, 26.10.2026) → Ladesäulenverordnung greift nicht
- [BELEGT] ⚠ ABWEICHUNG: „Ladung starten“ per Scan (0.29.0) wieder entfernt (Lukas, 26.10.2026). Stattdessen beim Erledigt der Aufgabe „Laden“ nur Abfrage der geladenen kWh, gespeichert in `tasks.energy_kwh` (0.30.0)
- [ANNAHME] kWh sind Pflicht beim Erledigt einer Ladeaufgabe (0 erlaubt), Eingabe mit Komma, höchstens 3 Nachkommastellen, 0–500
- [BELEGT] Bricht eine Ladung ab, startet die Säule nach dem Neu-Anstecken einen neuen Vorgang ab 0 kWh; das Erfassen wird dabei leicht vergessen (Lukas, 26.10.2026)
- [ANNAHME] Jeder Ladevorgang wird einzeln erfasst (`tasks.energy_parts`): „Zwischenstand erfassen“ während der Aufgabe, beim Erledigt zusätzlich vergessene Vorgänge nachtragbar; `energy_kwh` = Summe, höchstens 20 Vorgänge je Aufgabe
- [BELEGT] QR-Code auf dem Kempower-Display (`kempower.io/c/<uuid>`) ist ein Token pro Ladevorgang, nicht pro Stecker

## Buchungen
- [ANNAHME] Zusätzliches Feld `fuel_type` (Verbrenner/Elektro/Hybrid) steuert Tank- und Ladestand im Protokoll: Verbrenner nur Tank, Elektro nur Ladestand, Hybrid beides
- [BELEGT] Akkustand in Prozent entfällt (Nachtrag 08.10.2026, umgesetzt in 0.14.0: Spalte `protocols.soc_percent` entfernt)
- [BELEGT] Ladestand wird wieder erfasst (Rückmeldung Lukas 09.10.2026, 0.16.0): `protocols.charge_level` in Prozent 1–100 als Textfeld (Elektro und Hybrid; Hybrid zusätzlich Tankstand-Slider)
- [ANNAHME] „Kunde / Firma“ landet in `customer_name`; `company` ist optional zusätzlich
- [ANNAHME] Leistungsaufgaben sind 120 min vor Abholung fällig (`settings.task_due_before_pickup_minutes`)
- [BELEGT] Zeitraum von Datum/Uhrzeit bis Datum/Uhrzeit, Umbuchungen möglich
- [BELEGT] Stornierte Buchungen werden nicht gelöscht, sondern auf „storniert" gesetzt
- [BELEGT] Felder laut Excel: Buchungs-Nr., Eingang am, Status, Kunde/Firma, Telefon, E-Mail, Kennzeichen, Leistung, Anreise, Abholung, Anzahl Tage, Parkplatz, Aufbereitung, Hol- & Bringservice, Transfer, Preis, Zahlungsstatus, Notizen
- [ANNAHME] Buchungsquelle im Prototyp: manuelles Anlegen + Excel-/CSV-Import im Format der Vorlage „ParkHandling_Buchungsliste" + Demo-Daten
- [ANNAHME] Zahlungsstatus: offen, teilweise, bezahlt, erstattet (nur Anzeige, keine Zahlungsabwicklung)
- [BELEGT] ⚠ ABWEICHUNG (22.10.2026): Erstes Portal ist Parkos (vorher [OFFEN]), siehe Abschnitt „Buchungsportal Parkos“
- [BELEGT] „Anzahl Tage“ zählt Kalendertage inklusive (23.–28.10. = 6 Tage, wie bei Parkos)

## Buchungsportal Parkos (neu 22.10.2026)
- [BELEGT] Eingang als HTML-Mail von `support@parkos.com` an `fly@parkhandling.com`, Betreff `Reservierung bei Parkos #<Nr>`; Reservierungsnummer alphanumerisch (z. B. `494PHBR`) → `external_ref`, `source = parkos`
- [BELEGT] Mail enthält: Name, Mobilnummer, Sprache, Fahrzeugmodell, Kennzeichen, Anzahl Personen, Parkform, Transfer-Typ, Flugnummer Hin/Rück, Ankunft am Parkplatz, Rückkehr am Flughafen, Positionen, Gesamtumsatz ParkHandling, Gesamtbetrag Kunde
- [BELEGT] Im Abschnitt „Parkplatz“ steht die eigene Betriebs-Telefonnummer (nicht mit der Kundennummer verwechseln)
- [BELEGT] Parkos-Kunden zahlen im Voraus bei Parkos → `payment_status = paid`
- [BELEGT] ⚠ ABWEICHUNG: Kennzeichen kommt mit Leerzeichen (`M MM 3839`) statt `M-AB 1234` → Normalisierung; Suche über `plate_normalized`
- [BELEGT] Parkos-Rückgabezeit = Landung am Flughafen, nicht Abholung am Platz
- [BELEGT] Felder `flight_out`, `flight_return`, `return_flight_at`, `customer_language`, `transfer_note` an Buchungen (0.22.0)
- [ANNAHME] `end_at` = Landung + 60 min (`settings.return_buffer_minutes`, ab 0.23.0 in den Einstellungen); Formular und Parkos-Import nutzen denselben Wert
- [BELEGT] Postfach `fly@parkhandling.com` enthält nur Buchungsmails (Reservierung, Umbuchung, Storno)
- [BELEGT] Kein zusätzlicher Drittanbieter für den Mail-Eingang (Entscheidung Lukas 22.10.2026) → automatischer Import später per IMAP-Abruf, nicht per Weiterleitung an einen Inbound-Dienst
- [ANNAHME] Import 0.23.0: Mail einfügen oder `.eml` hochladen (Fahrzeuge → Parkos-Mail). Parser (`src/booking-adapters/parkos-email.ts`, ohne DOM) und Datenbankfunktion `import_booking_mail` werden vom IMAP-Abruf unverändert mitbenutzt
- [ANNAHME] IMAP-Abruf (folgt): Edge Function per Cron alle 5 min, IMAPS, Passwort nur als Supabase-Secret, nur Mails von `@parkos.com`, Ordner „Importiert“/„Prüfen“
- [ANNAHME] Bei `.eml` muss der Absender auf `parkos.com` enden, sonst nur Prüfliste (`sender_unverified`); eingefügter Text hat keinen Absender und gilt als vom Mitarbeiter geprüft
- [ANNAHME] ⚠ ABWEICHUNG vom Issue: Unbekannte Parkform legt keine Buchung mit leerer Parkart an (Spalte ist Pflicht), sondern landet in der Prüfliste; im Import-Dialog kann die Parkart von Hand gewählt werden (Hinweis `parking_type_manual`)
- [ANNAHME] Notizen werden beim Import nicht überschrieben; Parkform und Rohtext stehen im Import-Protokoll (`booking_imports`)
- [ANNAHME] Änderungs-/Stornomails bis zum Vorliegen von Beispielen nur als `needs_review` (Prüfliste unter Fahrzeuge → „n prüfen“)

## Lageplan & Scannen
- [ANNAHME] Je Hallenregal genau eine Spalte (Code `R3-E1`); das Datenmodell erlaubt mehrere Spalten je Regal
- [ANNAHME] QR-Inhalte: Stellplatz und Fach `PF-LOC:<Code>`; reine Codes werden als Stellplatz erkannt, `PF-KEY:<Code>` aus 0.17.0 ebenfalls
- [ANNAHME] Außenplatz-Vorschlag: „Außen mit Plane“ → Außen A, „Außen“ → Außen B, sonst Pufferzone
- [ANNAHME] Übergabe nur über das Übergabeprotokoll: in der Übergabezone vorbereiten (Entwurf), bei der Übergabe unterschreiben; der Abschluss checkt das Fahrzeug aus
- [ANNAHME] Umsetzen eines Blockierers kostet 2 Bewegungen (raus und wieder rein)

## Shuttle & Transfer
- [BELEGT] Shuttle stündlich innerhalb von Betriebszeiten, Premium auf Abruf
- [ANNAHME] Betriebszeiten 05:00–23:00, Takt 60 min, 1 Bus mit 8 Plätzen
- [BELEGT] Nachtrag 08.10.2026: „Hol- & Bringservice“ (`return_mode` `pickup_delivery`) ersetzt den Vallet-Service; umgesetzt in 0.14.0. Bestehende Buchungen mit `vallet` werden umgeschrieben, ein Trigger schreibt auch Eingaben älterer Tablets um
- [BELEGT] ⚠ ABWEICHUNG: Hol- & Bringservice = Übergabe am Terminal (Entscheidung Lukas 25.10.2026). Der Kunde gibt das Auto am Terminal ab, der Fahrer bringt es auf den Platz; zur Rückkehr steht es am Terminal bereit. Ersetzt die Annahme „nur Kundenabholung/Rückbringen“ aus 0.14.0. Die Transfer-Spalte „Vallet/Terminal“ der Excel-Vorlage passt damit
- [ANNAHME] Hol- & Bringservice (0.26.0): je Fahrzeug zwei eigene Aufträge (`transport_jobs.type = pickup_delivery`), kein Sammel-Slot und keine Busplätze
- [ANNAHME] Übernahme am Terminal zur Ankunftszeit der Buchung (`start_at` = Ankunft am Flughafen statt am Platz)
- [BELEGT] Treffpunkt = Terminal, an dem der Gast ankommt, ermittelt aus der Flugnummer (Lukas, 25.10.2026): Übernahme am Terminal des Hinflugs, Rückgabe am Terminal des Rückflugs
- [ANNAHME] Terminal über den Airline-Code der Flugnummer (`settings.airport_terminal_map`): Lufthansa-Gruppe und Star Alliance → T2, alle anderen → T1. Zuordnung ohne Gewähr (Codeshares, Änderungen am Flughafen), in den Einstellungen änderbar
- [BELEGT] Fahrer fährt mit dem Shuttle: nach der Rückgabe mit dem nächsten Shuttle zurück (Lukas, 25.10.2026)
- [ANNAHME] Zur Übernahme fährt der Fahrer mit dem letzten Shuttle hin, der vor der Übergabe am Terminal ist (Fahrzeit 16 min, `settings.shuttle_transfer_minutes`); Übergabe dauert 15 min (`settings.valet_handover_minutes`)
- [ANNAHME] Der Fahrer zählt noch nicht zur Buskapazität (8 Plätze)
- [BELEGT] Rückgabe am Terminal 30 min nach der Landung (`settings.valet_return_after_landing_minutes`), bestätigt von Lukas 25.10.2026; ohne Landezeit ab Abholung − Puffer
- [ENTFALLEN] Vallet als eigene Leistung und als Shuttle-Fahrtart (`transport_jobs.type = vallet`, entfernt in 0.14.0)
- [ANNAHME] Shuttle-Dispo (0.24.0): Fahrten entstehen automatisch aus jeder aktiven Buchung mit `return_mode = shuttle`, je eine Hin- und Rückfahrt
- [ANNAHME] Hinfahrt = nächster Slot ab Ankunft am Platz + 15 min für Annahme und Protokoll (`settings.shuttle_checkin_minutes`)
- [ANNAHME] Rückfahrt = nächster Slot ab Landung + 30 min für Gepäck (`settings.shuttle_pickup_after_landing_minutes`); ohne Landezeit ab Abholung − Puffer
- [ANNAHME] Slots im Takt ab Beginn der Betriebszeit (05:00, 06:00, …); liegt die Fahrt außerhalb 05:00–23:00, wird sie eine Fahrt „auf Abruf“
- [ANNAHME] „Premium“ = Halle (`parking_type = indoor`): immer Fahrt auf Abruf zur genauen Uhrzeit statt Slot
- [ANNAHME] Kapazität 8 wird nur geprüft und gewarnt (Dispo, Dashboard), nicht automatisch auf andere Slots verteilt, damit niemand einen Flug verpasst
- [ANNAHME] Von der Dispo umgesetzte Fahrgäste und laufende/erledigte Fahrten plant die App nicht mehr um; Umbuchung, Storno und Personenzahl planen sonst automatisch neu
- [BELEGT] ⚠ ABWEICHUNG: Eigene Rolle „Fahrer“ (Lukas, 25.10.2026), ersetzt „Fahrer = beliebiges Personal“. Fahrerauswahl in der Dispo zeigt Konten mit Rolle Fahrer (gibt es noch keine: alle aktiven Konten); wer ohne Einteilung „Losfahren“ tippt, wird Fahrer der Fahrt

## Protokolle & Mails
- [BELEGT] Unterschrift bei Annahme und Übergabe, Layout aus Vehicle Protocol Pro V2
- [ANNAHME] Im Prototyp gehen alle Mails nur an eine Testadresse aus `settings`
- [ANNAHME] PDF-Vorlage aus `fahrzeug-protokolle-v2` (Commit 5d29dc6, Ordner `pdf-template/`) unverändert übernommen, nur um eine Option für Beschriftungen ergänzt; CarHandling-Logo und Branding bleiben, bis ein Park-&-Fly-Logo vorliegt
- [ANNAHME] Das PDF wird im Browser erzeugt (pdf-lib, wie in der Vorlage) und über den Media-Service gespeichert, nicht serverseitig. Grund: Vorlage ist Browser-Code, funktioniert offline; die Edge Function verschickt nur das gespeicherte PDF
- [ANNAHME] Die Standardschrift der Vorlage (Helvetica) kann nicht alle Sonderzeichen; feste Beschriftungen sind daher ohne Umlaute („Uebergabe“), eingegebene Texte mit Umlauten funktionieren
- [ANNAHME] Übergabeprotokoll nutzt das Überführungs-Layout der Vorlage mit Titel „Fahrzeug-Uebergabeprotokoll“, Empfänger = Kunde; der Vergleich zur Annahme (KM, Tank/Akku, neue Schäden) steht in den Bemerkungen
- [BELEGT] Kilometerstand mit einer Nachkommastelle: Eingabe mit Dezimalkomma („84213,5“), Speicherung mit Punkt (`numeric(10,1)`), 0.14.0
- [BELEGT] Tankstand als Slider mit 8 Segmenten (`smallint` 0–8), 0.14.0. Bestehende Prozentwerte (10/25/50/75/100 %) wurden auf Segmente umgerechnet (1/2/4/6/8)
- [BELEGT] Schadenseinträge haben einen eigenen Speichern-Button; ungespeicherte Änderungen blockieren das Abschließen, bereits hochgeladene Schadensfotos bleiben erhalten (0.14.0)
- [BELEGT] Schadensfotos (`owner_type` damage): längste Kante 2400 px, WebP 0,85, Ziel ca. 500 KB. Alle übrigen Fotos bleiben 1600 px / 0,75; Thumbnails 320 px. Lightbox mit Pinch-to-Zoom und Doppeltippen (0.14.0)
- [ANNAHME] Pflicht zum Abschließen: Mitarbeiter, Kilometerstand, Tankstand (bei Verbrenner und Hybrid), Ladestand (bei Elektro und Hybrid), vollständige Schadensangaben, Name und Unterschrift Kunde, Unterschrift Mitarbeiter; Fotos sind optional
- [ANNAHME] Abgeschlossene Protokolle sind unveränderlich (Datenbank-Trigger); je Buchung genau ein Annahme- und ein Übergabeprotokoll
- [ANNAHME] Annahmeprotokoll ist vor dem Einchecken vorgesehen, blockiert es aber nicht (Hinweis im Check-in)

## Benachrichtigungen (neu 25.10.2026, 0.25.0)
- [BELEGT] Push-Benachrichtigungen für das Personal bei: neuer Buchung, Umbuchung/Storno, Import prüfen, Regal-Konflikt/Umsetzen, Ankunft bald, Abholung bald, Fahrzeug bereit, Shuttle fällig (Entscheidung Lukas 25.10.2026)
- [BELEGT] Neue App-Version wird **nicht** per Push gemeldet, nur per Banner
- [ANNAHME] Web Push (VAPID) über Edge Function `push-send`, Auslösung per Trigger und `pg_cron`, Zustellung per `pg_net`, kein Drittanbieter
- [BELEGT] Empfänger je Ereignis als Mehrfachauswahl aus Personal, Admins, Fahrer (Lukas, 25.10.2026); „Personal“ schließt Admins ein
- [ANNAHME] Vorbelegung (`settings.notifications`): Import prüfen → Admins; Shuttle fällig → Fahrer + Personal (eingeteilter Fahrer direkt); alle anderen → Personal. Jedes Gerät kann Ereignisse abbestellen
- [ANNAHME] Vorlauf: Ankunft 60 min, Abholung 60 min, Umsetz-Erinnerung 60 min vor Fälligkeit, Shuttle 15 min
- [ANNAHME] Wer eine Buchung selbst anlegt/ändert, bekommt dazu keine Meldung; Umsetz-Konflikte gehen auch an den Auslöser
- [ANNAHME] Push-Inhalt ohne Kundennamen und Kontaktdaten (nur Kennzeichen, Zeiten, Platz, Status)
- [ANNAHME] Keine Ruhezeiten; Demo-Daten lösen keine Meldungen aus
- [ANNAHME] Bei geöffneter App Hinweis in der App statt Systembenachrichtigung; iPhone/iPad zeigen trotzdem die Systembenachrichtigung (Safari entzieht sonst die Berechtigung)
- [BELEGT] iPhone/iPad: Push nur in der installierten App (Home-Bildschirm, ab iOS/iPadOS 16.4)

## Nutzer & Geräte
- [BELEGT] ⚠ ABWEICHUNG: Rollen Admin, Personal, Fahrer, beliebig kombinierbar (Lukas, 25.10.2026; vorher nur `staff`/`admin`). Gespeichert in `profiles.roles`, `profiles.role` bleibt für ältere App-Versionen synchron
- [BELEGT] Reiner Fahrer (ohne Personal/Admin) sieht nur die Shuttle-Ansicht (Fahreransicht) und die Einstellungen; Buchungen, Lageplan und Aufgaben sind für ihn gesperrt (RLS)
- [ANNAHME] Admin umfasst alle Rechte von Personal; Fahrer darf Fahrten starten/abschließen und sich eintragen, aber nicht umsetzen oder Zeiten ändern
- [ANNAHME] Reiner Fahrer sieht Kennzeichen, Personen, Flug, Terminal und Telefon (Anrufen), aber keine Buchungsdetails
- [ANNAHME] Login per E-Mail + Passwort (Supabase Auth), PIN-Login später
- [ANNAHME] Keine Selbstregistrierung. Eingeladene müssen beim ersten Login ihr Passwort festlegen (bestätigt). Konten legt nur ein Admin per Einladung an (E-Mail + Rollen, Edge Function `user-invite`). Die eingeladene Person vergibt ihr Passwort auf `/passwort` (mindestens 12 Zeichen).
- [ANNAHME] Profile werden nur deaktiviert, nicht gelöscht. Der letzte aktive Admin lässt sich nicht deaktivieren oder herabstufen.
- [ANNAHME] Geräte: Android-/iOS-Tablets quer und Smartphones, Chrome/Safari aktuell

## Technik
- [ANNAHME] Schrift IBM Plex Sans/Mono wie im Klick-Prototyp, per Google Fonts geladen und vom Service Worker zwischengespeichert (offline nach erstem Laden)
- [ANNAHME] Shuttle/Hol- & Bringservice ist in der Navigation von Phase 1 ausgeblendet (laut Startauftrag nicht Teil von Phase 1)
- [ANNAHME] Supabase-Region EU (Frankfurt) – das bestehende Projekt `parkhandling` liegt laut Supabase in `eu-west-1` (Irland); Region nur bei Neuanlage wählbar
- [ANNAHME] Nur Testdaten bis Datenschutz und Hosting geklärt sind

## Landingpage (Stufe 1, `landing/` 0.1.0)
- [ANNAHME] Unterordner-Struktur: Die Landingpage liegt im Repo `parkhandling` unter `landing/`, als eigenständige App (eigenes `package.json`, `CHANGELOG.md`, `README.md`, eigene Fly-App `parkhandling-landing`, Build-Kontext nur `landing/`). Kein Import aus `src/`; gemeinsam genutzt wird nur `supabase/`
- [ANNAHME] Eigene Versionierung: Version der Landingpage nur in `landing/package.json` (Start `0.1.0`), Anzeige im Footer über `__APP_VERSION__`. Die Version der internen App bleibt davon unberührt
- [ANNAHME] Eigene Tabelle `inquiries` statt `bookings`, damit der Status-Flow der internen App unverändert bleibt. Status `new`, `contacted`, `converted`, `rejected`; Übernahme in eine Buchung über `converted_booking_id` (manuell, Stufe 2). Zusätzliche Spalte `notification_status` (Ergebnis der Betriebsmail)
- [ANNAHME] Bestätigungsmail an den Kunden aus (`settings.inquiry_customer_confirmation = false`), bis Mail-Anbieter und Datenschutz geklärt sind. Benachrichtigung an den Betrieb geht an `settings.inquiry_notify_address`, solange `null` an `settings.mail_test_address`
- [ANNAHME] Preise werden nicht angezeigt, sondern „auf Anfrage“ (Preisliste offen)
- [ANNAHME] Kennzeichen als Freitext, max. 15 Zeichen, in Großbuchstaben gespeichert; Vor- und Nachname max. 100, E-Mail max. 254, Telefon max. 30 Zeichen
- [ANNAHME] Kennzeichen, Vor- und Nachname, E-Mail, Anreise, Abholung und Stellplatzart sind Pflicht; Telefon, Leistungen und Nachricht optional
- [ANNAHME] Abholung muss mindestens einen Tag nach der Anreise liegen (gleicher Tag nicht möglich); Anreise heute ist erlaubt, höchstens 365 Tage im Voraus. Nur Datum, keine Uhrzeit (Uhrzeit/Flug in der Nachricht)
- [ANNAHME] Datumsfeld als natives Datumsfeld des Browsers (zeigt in deutschen Browsern TT.MM.JJJJ); zusätzlich wird das gewählte Datum als „Mo., 12.10.2026“ angezeigt
- [ANNAHME] Spam-Schutz: Honeypot und zu schnelles Ausfüllen (< 3 s, im Browser gemessen) werden still verworfen (Antwort wie Erfolg, nichts gespeichert). Rate-Limit zählt jeden Versuch, auch verworfene; IP wird nur als HMAC gespeichert und nach einem Tag gelöscht
- [ANNAHME] UTM: neue UTM-Parameter ersetzen die gespeicherten der Sitzung vollständig (letzte Anzeige zählt); Referrer nur von fremden Seiten, beim ersten Aufruf der Sitzung
- [ANNAHME] Keine Webfonts (Systemschrift) und keine externen Ressourcen, damit keine Daten an Dritte gehen; Content-Security-Policy erlaubt nur die eigene Seite und Supabase
- [ANNAHME] Bis zum Go-live `noindex` (Meta-Tag, `X-Robots-Tag`, `robots.txt`). Automatisches Deployment vorbereitet, aber aus (`LANDING_DEPLOY_ENABLED`)
- [ANNAHME] Edge Function `inquiry-submit` wird ohne JWT-Prüfung deployt (`--no-verify-jwt`), da die Seite anonym sendet

## Landingpage Online-Buchung (Stufe 2, `landing/` 0.3.0)
- [BELEGT] Der Kunde landet über den Button „Jetzt buchen“ auf der Jimdo-Website auf der Buchungsseite der Landingpage, gibt Daten ein und bezahlt mit PayPal (auch Kreditkarte über PayPal)
- [BELEGT] Die Buchung geht nach der Zahlung direkt in die Park Handling App (Tabelle `bookings`) und ist sofort bestätigt; die Bestätigungsmail geht sofort an den Kunden
- [BELEGT] Preise: vier Tarife laut Preiskategorien-Vorlage, Dauerklassen 5–8 / 9–15 / 16–30 Tage. Unter 5 Tagen kein Preis (keine Online-Buchung), über 30 Tage ist der Monatstarif nicht vorgesehen
- [BELEGT] Der Hol- & Bringservice ist als Rückgabe-Option wählbar, Shuttle ist im Tarif enthalten
- [BELEGT] Preise brutto in EUR inkl. Umsatzsteuer (AGB Ziffer 8.1, bestätigt durch den Entwurf). Vorher Kunde: „denke brutto, bin nicht komplett sicher“
- [ANNAHME] Dauer = Kalendertage zwischen Anreise- und Abholdatum; Uhrzeiten werden als Berliner Ortszeit gespeichert
- [ANNAHME] Stellplatzart der Buchung folgt dem Tarif: Economy → Außen ohne Plane, Cover (Code `space`) → Außen mit Abdeckplane, Business und Premium → Halle (Indoor)
- [ANNAHME] Online-Buchung: Halle gilt als voll, wenn im Zeitraum zu irgendeinem Zeitpunkt so viele Indoor-Buchungen (nicht storniert/abgeschlossen) gleichzeitig laufen, wie es aktive, nicht gesperrte Hallenplätze gibt (`indoor_full`); dann sind Business und Premium „Ausverkauft“
- [BELEGT] Online-Buchung frühestens 12 Stunden vor der Anreise (Review-Notiz Lukas 27.10.2026)
- [ANNAHME] Buchungsquelle `landing`, Zahlungsreferenz (PayPal-Order-ID) als `external_ref`, Buchungsnummer `PF-<erste 8 Zeichen der Buchungs-ID>`
- [ANNAHME] Zusatzleistungen (z. B. Fahrzeugaufbereitung) sind online noch nicht buchbar; die Anmerkungen nehmen Wünsche auf
- [ANNAHME] Absender der Bestätigung: `booking@parkhandling.de` als Platzhalter (Einstellung `booking_confirmation_from`); tatsächlich versendet wird über die Secret-Adresse `MAIL_FROM`, bis die Absenderadresse feststeht
- [ANNAHME] Sandbox-Zahlungen über `PAYPAL_ENV=sandbox`, Standard. Live erst nach Freigabe
- [ANNAHME] Die bestehende Anfrage-Funktion und die Tabelle `inquiries` bleiben vorerst unverändert im Repo, werden aber nicht mehr genutzt
- [BELEGT] AGB und Widerrufsbelehrung umgesetzt (`/agb`, `/widerruf`, Stand 2026-10, aus `legal/AGB_2026-10.txt`, erzeugt mit `scripts/build-legal.py`). Der interne Abschnitt „Zusatzleistungen und Umsetzung“ steht nicht auf der Seite und nicht in der Mail
- [BELEGT] Vertragsschluss mit Zugang der Buchungsbestätigung. Die Mail nimmt die Buchung ausdrücklich an und enthält AGB und Widerrufsbelehrung im Volltext (AGB Ziffer 2.2, 2.3)
- [BELEGT] Zustimmung zur Pflicht-Checkbox für AGB und Kenntnis der Widerrufsbelehrung; Zustimmung zum frühen Leistungsbeginn nur bei Anreise innerhalb von 14 Tagen, nicht vorangekreuzt (AGB 12.2, Entwurf „Umsetzung“)
- [BELEGT] Stornierung kostenlos bis 24 Stunden vor Leistungsbeginn in Textform, insbesondere per E-Mail (AGB 10.1). Kein Online-Storno-Button
- [BELEGT] Shuttle: Flugnummern Hin- und Rückflug Pflicht; Kindersitze 0–3 und Gepäckstücke werden erfasst (AGB 4.1, 7.4). Die Angaben stehen in den Notizen der Buchung, nicht in eigenen Spalten
- [BELEGT] Online-Widerruf auf `/widerruf` gebaut (Eingangsbestätigung, § 356a BGB). AGB-Text verweist auf „Widerruf“ der Landingpage, nicht mehr auf parkhandling.de
- [OFFEN] Endgültige Domain der Landingpage für den vollständigen Link in den AGB
- [BELEGT] Vorschau für Freigaben ohne Fly.io: Dev-Server mit öffentlichem Tunnel, Kommentare im Review-Modus (`?review=<Token>`, Tabelle `review_notes`, Function `review-notes`)
- [BELEGT] Mailausfall nach Zahlung: Status am Zwischenspeicher, Hinweis an den Betrieb, erneute Anforderung durch den Kunden. Kein automatischer Wiederholversuch
- [OFFEN] Rechtliche Prüfung durch einen Rechtsanwalt vor Go-live (der Entwurf verlangt sie selbst). Schlichtungsangabe fehlt im Entwurf
- [OFFEN] Fahrzeugmaße werden nicht erfasst (AGB 4.1). Mechanische Parksysteme (AGB 5.3) sind nicht online buchbar
- [OFFEN] Absenderadresse der Buchungsbestätigung, Mail-Anbieter (Resend) und Domain
- [OFFEN] Ob die Buchung mit Zahlung auch bei Park OS-Buchungen gilt; Park OS liefert eigene Buchungen (Schnittstelle/E-Mail noch offen)
- [ANNAHME] Review-Notizen (landing 0.7.0): Markier-Werkzeug (Stift, Text, Element) nur im Dev-Server, nicht im Produktions-Build. Notizen als Dateien in `landing/review/` (`NOTES.md` für Claude Code, `notes.json`, Screenshots), Umsetzung mit `/review-umsetzen`. Markierungen beziehen sich auf die Bildschirmbreite beim Markieren; auf deutlich anderer Breite werden sie blass angezeigt. Der bisherige Review-Modus mit Supabase (`?review=<Token>`, 0.6.0) bleibt unverändert bestehen

## Landingpage-Daten in der App (0.33.0)
- [ANNAHME] Im Tarif enthaltene Leistungen (`booking_tariffs.included_services`): nur Premium bucht zusätzlich **Servicearbeiten** (Luftdruck, Betriebsflüssigkeiten, CarCover). Die Reinigung aller Tarife deckt die Standard-Grundreinigung ab; „Grob-Reinigung“ (Cover, Business) ist keine eigene Leistung
- [ANNAHME] Anfrage → Buchung: Parkplatz „egal“ wird Außen, Hol- & Bring geht vor Shuttle, ohne Transferwunsch „Selbst“. Aufbereitungswunsch und Nachricht landen in der Notiz (Umfang mit dem Kunden klären); Uhrzeiten fehlen in der Anfrage
- [ANNAHME] Ein Online-Widerruf wird nur angezeigt; Stornieren und Erstatten entscheidet das Personal
