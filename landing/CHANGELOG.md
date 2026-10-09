# Änderungsprotokoll – Landingpage

Änderungen an der öffentlichen Landingpage in `landing/`. Eigene Versionsnummer, unabhängig von der
internen App. Versionierung nach [SemVer](https://semver.org/lang/de/):
`patch` = Fehlerbehebung/Text, `minor` = neue Funktion, `major` = Breaking Change.
Die Version steht ausschließlich in `landing/package.json` und wird im Footer angezeigt.

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
