# ANNAHMEN – Park & Fly Prototyp

Stand: 08.10.2026 · Diese Datei gehört ins Repo-Root und wird bei jeder geklärten Frage aktualisiert.

Legende: **[BELEGT]** = aus Gespräch, Excel-Vorlage oder Nachtrag bestätigt · **[ANNAHME]** = Platzhalter, später anpassen · **[OFFEN]** = bewusst nicht umgesetzt · **[ENTFALLEN]** = nicht mehr Teil des Konzepts

Verbindlich ist `docs/PARK_AND_FLY_Arbeitsanweisung.md`, geändert durch `docs/ARBEITSANWEISUNG_Nachtrag_08-10-2026.md` (Nachtrag hat bei Widersprüchen Vorrang).

Alle Werte mit [ANNAHME] liegen als Seed-Daten oder in `settings` und sind ohne Code-Änderung anpassbar.

## Betrieb
- [BELEGT] Standort: Park & Fly Flughafen München
- [BELEGT] Ca. 100–120 Stellplätze, davon ca. 25 Indoor (Premium)
- [BELEGT] Indoor-Regale abhängig, 3 Ebenen; frühe Abholung unten
- [ANNAHME] Halle: 8 Regalspalten × 3 Ebenen = 24 Plätze (R1–R8, E1–E3)
- [ANNAHME] Außen A (mit Abdeckplane): 2 Reihen × 24 Plätze (A1, A2)
- [ANNAHME] Außen B (ohne Plane): 2 Reihen × 24 Plätze (B1, B2)
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
- [OFFEN] Anbindung des echten Buchungsportals

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
- [OFFEN] Hol- & Bringservice nur Kundenabholung/Rückbringen oder auch Transfer zum Terminal? Umgesetzt (0.14.0): nur Kundenabholung/Rückbringen. Die Transfer-Spalte „Vallet/Terminal“ aus der Excel-Vorlage wird ebenfalls als Hol- & Bringservice übernommen, bis die Frage geklärt ist
- [ENTFALLEN] Vallet als eigene Leistung und als Shuttle-Fahrtart (`transport_jobs.type = vallet`, entfernt in 0.14.0)
- [OFFEN] Flugstatus-Abfrage

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
- [OFFEN] Mail-Dienst zurückgestellt (Entscheidung 06.10.2026: vorerst nicht wichtig). Vorbereitet ist Resend in der Edge Function `protocol-mail` (Secrets `RESEND_API_KEY`, `MAIL_FROM`); ohne Schlüssel wird „Mail-Dienst nicht eingerichtet“ vermerkt, Protokolle und PDFs funktionieren vollständig
- [OFFEN] Aufbewahrungsfrist (Platzhalter in `settings`: 365 Tage, Löschjob deaktiviert)

## Nutzer & Geräte
- [ANNAHME] Rollen: `staff` und `admin`
- [ANNAHME] Login per E-Mail + Passwort (Supabase Auth), PIN-Login später
- [ANNAHME] Keine Selbstregistrierung. Eingeladene müssen beim ersten Login ihr Passwort festlegen (bestätigt). Konten legt nur ein Admin per Einladung an (E-Mail + Rolle, Edge Function `user-invite`). Die eingeladene Person vergibt ihr Passwort auf `/passwort` (mindestens 12 Zeichen).
- [ANNAHME] Profile werden nur deaktiviert, nicht gelöscht. Der letzte aktive Admin lässt sich nicht deaktivieren oder herabstufen.
- [ANNAHME] Geräte: Android-/iOS-Tablets quer und Smartphones, Chrome/Safari aktuell

## Technik
- [ANNAHME] Schrift IBM Plex Sans/Mono wie im Klick-Prototyp, per Google Fonts geladen und vom Service Worker zwischengespeichert (offline nach erstem Laden)
- [ANNAHME] Shuttle/Hol- & Bringservice ist in der Navigation von Phase 1 ausgeblendet (laut Startauftrag nicht Teil von Phase 1)
- [ANNAHME] Supabase-Region EU (Frankfurt) – das bestehende Projekt `parkhandling` liegt laut Supabase in `eu-west-1` (Irland); Region nur bei Neuanlage wählbar
- [ANNAHME] Nur Testdaten bis Datenschutz und Hosting geklärt sind
