# Startauftrag Phase 1 – Park & Fly Prototyp

Du baust einen funktionsfähigen Prototyp der Park & Fly App. Lies zuerst vollständig:

1. `docs/PARK_AND_FLY_Arbeitsanweisung.md` – verbindliche Regeln, Datenmodell, Regal-Logik, Update-Flow, Skalierung
2. `ANNAHMEN.md` – alle Platzhalterwerte für noch offene Fragen

Bei Widersprüchen gilt die Arbeitsanweisung. Wo eine Information fehlt, triff eine sinnvolle Annahme, trage sie in `ANNAHMEN.md` als **[ANNAHME]** ein und arbeite weiter. Nicht anhalten, um nachzufragen.

## Ziel von Phase 1

Ein Mitarbeiter kann mit Testfahrzeugen den kompletten Ablauf durchspielen:
**Buchung anlegen/importieren → Annahmeprotokoll mit Unterschrift → Einchecken mit Platzvorschlag → Aufgaben abarbeiten (mit Fotos) → Status „bereit" → Auschecken → Übergabeprotokoll.**

## Umfang (in dieser Reihenfolge)

1. **Setup:** Vite + React 19 + TypeScript + Tailwind 4, `vite-plugin-pwa`, Supabase-Client, Fly.io-Deployment (statisch). Version `0.1.0`, `CHANGELOG.md`, Versionsanzeige.
2. **Aktualisierungs-Flow** nach Abschnitt 6 (Banner, Zurückhalten bei offenem Protokoll, `version.json`).
3. **Datenmodell** nach Abschnitt 3 als Migrationen, inkl. Indizes aus 11.5, RLS-Policies für Rollen `staff` und `admin`.
4. **Seed:** Stellplätze, Arbeitsorte, Schlüsselfächer und Leistungskatalog gemäß `ANNAHMEN.md`, dazu ~40 Demo-Buchungen über die nächsten 14 Tage (fiktive Namen, Kennzeichen im Format `M-AB 1234`, gemischt Indoor/Außen/E-Fahrzeuge, inkl. einer bewusst falsch sortierten Regalspalte).
5. **Media-Service** nach Abschnitt 11 (Komprimierung, Thumbnails, Signed Uploads, Offline-Queue).
6. **Buchungen:** manuell anlegen/bearbeiten/stornieren (Status „storniert", nie löschen) und **Excel-/CSV-Import** als erster `BookingAdapter`.
   - Erwartetes Format = Vorlage „ParkHandling_Buchungsliste", Sheet „Buchungseingänge", Spalten:
     `Buchungs-Nr. | Eingang am | Status | Kunde / Firma | Telefon | E-Mail | Fahrzeug / Kennzeichen | Leistung | Anreise / Fahrzeugabgabe | Abholung / Rückgabe | Anzahl Tage | Parkplatz | Aufbereitung / Pflege | Hol- & Bringservice | Transfer Flughafen | Preis (€) | Zahlungsstatus | Besondere Wünsche / Notizen`
   - Deutsche Datums-/Zeitformate und Dezimalkomma tolerant parsen. „Anzahl Tage" nicht importieren, sondern berechnen.
   - Mapping-Vorschau vor dem Import, Duplikate über `Buchungs-Nr.` erkennen (Update statt Neuanlage, Eintrag in `booking_history`).
   - Freitext in „Fahrzeug / Kennzeichen" in Kennzeichen und Modell aufteilen, bei Unsicherheit beides im Kennzeichenfeld lassen und markieren.
7. **Lageplan** Halle/Außen mit Ein-/Auschecken (QR-Scan + Auswahl), Bewegungshistorie, Schlüsselzuordnung.
8. **Regal-Logik** nach Abschnitt 5 inkl. Unit-Tests (mindestens: leere Spalte, korrekte Reihenfolge, Konflikt nach Umbuchung, gesperrte Ebene).
9. **Aufgaben** mit automatischer Erzeugung, Teilschritten, Fotos und Status „bereit".
10. **Protokolle** Annahme/Übergabe mit Unterschrift und PDF. Mailversand nur an die Testadresse aus `settings`.
11. **Heute-Ansicht** und Fahrzeugliste mit Zahlungsstatus-Spalte.

UI-Referenz: der Klick-Prototyp (`mockup/`, Einstieg `index.html`). Farben, Statusfarben nach Abholdatum, Navigation (Seitenleiste Tablet, Bottom-Bar mit Scan-Button am Smartphone) übernehmen.

## Nicht in Phase 1
Echte Portal-Anbindung, Shuttle-/Vallet-Planung, automatische Kunden-Mails, Kundenportal, Flugstatus, Aufbewahrungs-Job (nur vorbereiten), Abrechnung.

## Regeln
- Version bei jeder Änderung erhöhen + `CHANGELOG.md` (Grundregel 1).
- Nur Testdaten, keine echten Kundendaten in Seeds, Tests oder Screenshots.
- Kleine, nachvollziehbare Commits je Schritt. Nach jedem Schritt: Build, Tests, Typecheck grün.
- Am Ende: `README.md` mit Setup, Umgebungsvariablen, Seed-Befehl und einer Kurzanleitung für den Testablauf.

## Abnahme Phase 1
- Komplettablauf mit 3 Testfahrzeugen (Indoor E-Auto, Außen mit Plane, Außen ohne Plane) auf Tablet und Smartphone durchführbar.
- Import der leeren Excel-Vorlage mit 5 testweise ausgefüllten Zeilen funktioniert, erneuter Import aktualisiert statt dupliziert.
- Regal-Konflikt erscheint nach Umbuchung und erzeugt eine Umsetz-Aufgabe.
- Ein Update-Deploy erscheint auf einem offenen Gerät als Banner und wird während eines offenen Protokolls zurückgehalten.
