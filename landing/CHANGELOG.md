# Änderungsprotokoll – Landingpage

Änderungen an der öffentlichen Landingpage in `landing/`. Eigene Versionsnummer, unabhängig von der
internen App. Versionierung nach [SemVer](https://semver.org/lang/de/):
`patch` = Fehlerbehebung/Text, `minor` = neue Funktion, `major` = Breaking Change.
Die Version steht ausschließlich in `landing/package.json` und wird im Footer angezeigt.

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
