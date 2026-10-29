# Änderungsprotokoll – Landingpage

Änderungen an der öffentlichen Landingpage in `landing/`. Eigene Versionsnummer, unabhängig von der
internen App. Versionierung nach [SemVer](https://semver.org/lang/de/):
`patch` = Fehlerbehebung/Text, `minor` = neue Funktion, `major` = Breaking Change.
Die Version steht ausschließlich in `landing/package.json` und wird im Footer angezeigt.

## 0.9.0 – 29.10.2026

### Geändert (Review-Notizen 27.10.2026)
- Tarif „Space“ heißt jetzt „Cover“ (#1); der Code bleibt `space`, bestehende Links mit `?tarif=space` funktionieren weiter
- Economy und Cover: „Geräumiger Außenstellplatz“ statt „Außenstellplatz 12 m²“ bzw. „15 m²“ (#2, #3)
- Migration `20261029000100_tariff_texts.sql` (nur Texte in `booking_tariffs`; von Hand geänderte Texte bleiben unberührt)
- Buchung mit Vorauswahl (Link „Jetzt buchen“ eines Tarifs): Es erscheinen nur der gewählte und die höherwertigen Tarife, günstigere nicht (#4). Ohne Vorauswahl stehen alle Tarife zur Wahl

## 0.8.0 – 29.10.2026

### Neu
- Markier-Werkzeug: Sicherungskopien der Notizen. Vor jedem Überschreiben von `landing/review/notes.json` wird die bisherige Fassung nach `landing/review/backup/notes-<Zeitpunkt>.json` kopiert (nur wenn sie Notizen enthält und sich etwas ändert, die letzten 100 bleiben)
- In der Liste der Knopf „Sicherungen“: zeigt alle Sicherungen mit Zeitpunkt und Anzahl Notizen, „Wiederherstellen“ holt einen Stand zurück. Der jetzige Stand wird dabei selbst gesichert, das Zurückholen lässt sich also rückgängig machen
- Test `npm run test:review` prüft Löschen und Wiederherstellen

## 0.7.0 – 26.10.2026

### Neu
- Markier-Werkzeug für Review-Notizen (nur `npm run dev`, nicht im Produktions-Build): Knopf „Markieren“ unten links
  - Stift: frei zeichnen (einkreisen, unterstreichen, Pfeile), auch über Bildern und Buttons; Weiterzeichnen ergänzt die Markierung
  - Text: Textstelle markieren, wird gelb hervorgehoben
  - Element: beliebiges Element anklicken (Klick löst keine Aktion aus)
  - Zu jeder Markierung eine Notiz; Liste aller Notizen mit „Anzeigen“, „Erledigt“, „Löschen“; Nummern-Abzeichen auf der Seite
- Notizen werden als Dateien gespeichert: `landing/review/notes.json` (Rohdaten) und `landing/review/NOTES.md` (aufbereitet für Claude Code mit Abschnitt, Überschrift, markiertem Text, Elementen und CSS-Pfad)
- Screenshots offener Markierungen automatisch in `landing/review/screens/<nr>.png` (Playwright im Dev-Server; ohne installierten Browser wird ohne Screenshots weitergearbeitet)
- Ohne Dev-Server (z. B. `npm run preview`) nicht verfügbar; Export als Datei bleibt im Werkzeug möglich
- Claude-Code-Befehl `/review-umsetzen` (`.claude/commands/review-umsetzen.md`) setzt die offenen Notizen um
- Test `npm run test:review` (Playwright gegen den Dev-Server, Notizen in einem temporären Ordner)

## 0.6.0 – 21.10.2026

### Neu
- Review-Modus für die Vorschau: Mit `?review=<Token>` erscheint ein Kommentarfenster. Abschnitte und Buttons sind markiert (`data-review`), per „Neuer Kommentar“ wird der Abschnitt angeklickt und kommentiert
- Kommentare landen in der Tabelle `review_notes` (Migration `20261021000100_review_notes.sql`) über die Edge Function `review-notes`. Zugriff nur mit dem Secret `REVIEW_TOKEN`
- Kommentare lassen sich als erledigt markieren und wieder öffnen

### Hinweis
- Ohne Token ist der Review-Modus nicht sichtbar, und die Seite lädt keine Kommentare

## 0.5.0 – 20.10.2026

### Neu
- Mailausfall nach bezahlter Buchung: Der Versandstatus steht am Zwischenspeicher (`booking_checkouts.confirmation_sent_at` bzw. `confirmation_error`, Migration `20261020000300_checkout_confirmation_state.sql`)
- Der Betrieb erhält eine Mail „Bestätigung NICHT versendet“ mit Buchungsnummer und Fehler
- Die Danke-Seite zeigt bei fehlgeschlagenem Versand einen Hinweis und die Schaltfläche „Bestätigung erneut senden“ (Aktion `resend`, nur für bezahlte Buchungen ohne erfolgreichen Versand, mit Rate-Limit)

### Offen vor Go-live
- Ein Fehlversand wird nicht automatisch wiederholt, sondern vom Kunden oder vom Betrieb ausgelöst

## 0.4.1 – 20.10.2026

### Geändert
- AGB Ziffer 12.2: Der Online-Widerruf verweist auf die Seite „Widerruf“ der Landingpage (`/widerruf`) statt auf `parkhandling.de/widerrufsrecht`. Die endgültige Domain der Landingpage ist noch offen

## 0.4.0 – 20.10.2026

### Neu
- Online-Widerruf auf `/widerruf` (AGB Ziffer 12.2, § 356a BGB): Buchungsnummer, E-Mail und Name, Bestätigung, Hinweis optional
- Widerruf wird über Buchungsnummer und E-Mail der Buchung zugeordnet. Doppelte Erklärungen liefern den ersten Eingang zurück
- Der Eingang wird mit Datum und Uhrzeit (Berliner Zeit) gespeichert und dem Kunden per E-Mail bestätigt. Der Betrieb erhält einen Hinweis
- Tabelle `booking_withdrawals` (Migration `20261020000200_booking_withdrawals.sql`, Personal liest, Schreiben nur über die Edge Function)

### Offen vor Go-live
- Vollständige Adresse der Landingpage in den AGB: Der Text nennt bisher nur den Pfad `/widerruf`. Sobald die Domain feststeht, Text ergänzen und `scripts/build-legal.py` ausführen
- Rückzahlung über PayPal und anteilige Abrechnung bei frühem Beginn passieren manuell

## 0.3.0 – 20.10.2026

### Neu (AGB und Widerruf umgesetzt, Entwurf `ParkHandling_AGB_Final`)
- Seiten `/agb` (Stand 2026-10) und `/widerruf` (Widerrufsbelehrung mit Muster-Formular), aus `legal/AGB_2026-10.txt` mit `scripts/build-legal.py` erzeugt. Der interne Abschnitt „Zusatzleistungen und Umsetzung“ ist nicht enthalten. Links im Footer
- Pflicht-Zustimmungen im Buchungsformular: AGB akzeptiert, Widerrufsbelehrung zur Kenntnis genommen. Die Prüfung läuft auch serverseitig und vor dem PayPal-Fenster
- Zustimmung zum frühen Leistungsbeginn (Widerruf) erscheint nur, wenn die Anreise innerhalb von 14 Tagen liegt, und ist nicht vorangekreuzt
- Shuttle-Buchungen verlangen Flugnummern (Hin- und Rückflug). Kindersitze (0–3) und Gepäckstücke werden erfasst
- Bestätigungsmail nimmt die Buchung ausdrücklich an, nennt Storno-Regel (kostenlos bis 24 Stunden vorher, per E-Mail) und enthält AGB und Widerrufsbelehrung im Volltext
- Notizen der Buchung dokumentieren AGB-Version, Zeitpunkt der Zustimmung und den Zustimmungsstatus zum frühen Beginn

### Geändert
- Danke-Seite und Buchungsseite sagen „angenommen“ statt „bestätigt“, weil der Vertrag mit der Bestätigungsmail zustande kommt
- Brutto-Preise sind durch AGB Ziffer 8.1 bestätigt

### Offen vor Go-live
- Online-Widerruf nach § 356a BGB (im AGB-Text versprochen, noch nicht gebaut)
- Rechtliche Prüfung durch Rechtsanwalt, Schlichtungsangabe
- Fehlgeschlagener Mailversand: Die Buchung ist bezahlt, aber der Vertrag entsteht erst mit der Mail. Der Fehler wird bisher nur protokolliert

## 0.2.1 – 20.10.2026

### Behoben
- Layout-Effekt gibt nichts mehr zurück (`destroy is not a function` bei Seitenwechsel, wenn `window.scrollTo` einen Wert liefert, z. B. durch Browser-Erweiterungen)

## 0.2.0 – 20.10.2026

### Neu (Stufe 2: Online-Buchung mit PayPal)
- `/anfrage` ist jetzt die Buchungsseite; das Anfrage-Formular entfällt. Der Link „Jetzt buchen“ führt von der Jimdo-Website hierher (`/anfrage?tarif=<code>` wählt einen Tarif vor)
- Vier Tarife aus der Preiskategorien-Vorlage (Economy, Space, Business, Premium) mit Preisen je Dauer: 5–8 Tage Wochenpreis, 9–15 Tage Ferienpreis, 16–30 Tage Monatspreis. Die Preise kommen aus der Datenbank (`booking_tariffs`), nicht aus dem Code
- Formularfelder wie in der Park Handling App: Anreise und Abholung mit Uhrzeit, Kennzeichen, Fahrzeug, Antrieb, Personen, Rückgabe (Shuttle, Hol- & Bringservice, Selbst), Name, Firma, E-Mail, Telefon, Anmerkungen
- Zahlung mit PayPal (PayPal-JavaScript-SDK nur auf der Buchungsseite). Der Betrag wird serverseitig berechnet, nie aus dem Browser übernommen
- Nach erfolgter Zahlung entsteht die Buchung sofort als bestätigt in `bookings` (Quelle `landing`, Zahlungsstatus „bezahlt“) und die Bestätigungsmail geht an den Kunden
- Edge Function `booking-checkout` (Aktionen `tariffs`, `create`, `capture`), Zwischenspeicher `booking_checkouts`, Idempotenz bei doppelten Aufrufen
- Migration `20261020000100_booking_checkout.sql`: Tabellen `booking_tariffs` und `booking_checkouts`, Einstellung `booking_confirmation_from`
- Startseite zeigt die Tarife und die Dauer-Preise; Danke-Seite nennt die Buchungsnummer

### Geändert
- Content-Security-Policy erlaubt PayPal (Skript, Bilder, Verbindungen, Frames), sonst keine Drittanbieter
- Die Anfrage-Edge-Function `inquiry-submit` und die Tabelle `inquiries` bleiben vorerst bestehen, werden aber nicht mehr verwendet

### Offen vor Go-live
- Preise brutto oder netto (Annahme: brutto), AGB und Widerrufsbelehrung für Online-Verträge, Absenderadresse der Bestätigung
- Buchungen unter 5 Tagen und über 30 Tagen sind nicht online buchbar

## 0.1.0 – 09.10.2026

### Neu (Stufe 1: Anfrage statt Online-Buchung)
- Startseite mit den Angeboten Park & Fly Halle (Premium, Indoor), Außen mit Abdeckplane, Außen ohne Plane, Shuttle und Fahrzeugaufbereitung als Zusatzleistung; Preise „auf Anfrage“
- Anfrageformular `/anfrage`: Anreise, Abholung, Stellplatzart, Kennzeichen, Vor- und Nachname, E-Mail, Telefon (optional), Zusatzleistungen (Shuttle, Fahrzeugaufbereitung, Hol- & Bringservice), Nachricht (max. 1000 Zeichen), Pflicht-Checkbox Datenschutzhinweis
- Prüfung im Formular: Anreise nicht in der Vergangenheit, Abholung nach Anreise, E-Mail-Format, Maximallängen; Datumsanzeige TT.MM.JJJJ, „heute“ nach Europe/Berlin
- Angebotskarten übernehmen die Stellplatzart ins Formular (`/anfrage?stellplatz=indoor`)
- Bestätigungsseite `/danke`, Platzhalterseiten `/impressum` und `/datenschutz` („wird vor Go-live ergänzt“)
- UTM-Parameter werden beim Laden gelesen, für die Sitzung im `sessionStorage` gehalten und mit der Anfrage gesendet; keine Cookies, keine Drittanbieter-Pixel, keine Webfonts von Drittanbietern
- Spam-Schutz: Honeypot-Feld und Ausfüllzeit (unter 3 Sekunden wird serverseitig verworfen)
- Seite ist bis zum Go-live `noindex` (Meta-Tag, `X-Robots-Tag`, `robots.txt`)
- Eigene Fly.io-App `parkhandling-landing` (statisch, kleinste Maschine, Auto-Stop), eigener Workflow mit Path-Filter, Deployment vorbereitet und standardmäßig aus
- Version im Footer aus `landing/package.json` über Vite (`__APP_VERSION__`)

### Backend (gemeinsames Supabase-Projekt)
- Tabelle `inquiries` mit Status `new`, `contacted`, `converted`, `rejected`; Lesen und Status ändern nur für aktives Personal, kein Schreibzugriff aus dem Browser. Migration `20261009000400_inquiries.sql`
- Edge Function `inquiry-submit`: serverseitige Prüfung, Rate-Limit (5 Anfragen pro IP und Stunde, IP nur als HMAC), Speichern, Benachrichtigung an den Betrieb
- Bestätigungsmail an den Kunden vorbereitet, per `settings.inquiry_customer_confirmation` standardmäßig aus
- Mail-Anbieter hinter austauschbarer Schnittstelle (`supabase/functions/_shared/mailer.ts`, aktuell Resend)
