# OFFENE FRAGEN – Park & Fly

Stand: 27.10.2026 · Fragen, die noch geklärt werden müssen. Geklärte Punkte wandern als [BELEGT]
nach `ANNAHMEN.md`; dort stehen auch alle Platzhalterwerte ([ANNAHME]).

Legende: **[OFFEN]** = noch zu klären bzw. bewusst noch nicht umgesetzt · **[ERLEDIGT]** = geklärt, Rest ggf. im Text

## App

### Laden
- [OFFEN] Vergessene Vorgänge lassen sich ohne Schnittstelle nur nachtragen, wenn der Wert bekannt ist (z. B. aus der Ladehistorie in ChargEye); automatisch prüfen ginge per Lese-Zugriff auf die Kempower-API (Summe aller Transaktionen der Säule zwischen Start und Erledigt)
- [OFFEN] Ladung per App über die API starten/stoppen (virtuelle RFID-Freigabe, Zuordnung über `authorizationToken`); Rechte und Endpunkte bei Kempower klären
- [OFFEN] Übersicht/Export aller Ladungen (Kennzeichen, kWh, Zeitraum) für die Abrechnung
- [OFFEN] Eichrechtskonformität der Säulen; Abrechnung pauschal oder pro kWh (rechtlich prüfen)

### Buchungsportal Parkos
- [OFFEN] Kunden-E-Mail in der Parkos-Mail? Aussehen von Änderungs-/Stornomails? Partner-API/Export? Weitere Portale? Postfach-Anbieter, IMAP-Zugang und Freigabe für Auto-Import?

### Shuttle & Transfer
- [OFFEN] Flugstatus-Abfrage (Flugnummern liegen seit 0.22.0 vor)

### Protokolle & Mails
- [OFFEN] Mail-Dienst zurückgestellt (Entscheidung 06.10.2026: vorerst nicht wichtig). Vorbereitet ist Resend in der Edge Function `protocol-mail` (Secrets `RESEND_API_KEY`, `MAIL_FROM`); ohne Schlüssel wird „Mail-Dienst nicht eingerichtet“ vermerkt, Protokolle und PDFs funktionieren vollständig
- [OFFEN] Aufbewahrungsfrist (Platzhalter in `settings`: 365 Tage, Löschjob deaktiviert)

### Benachrichtigungen
- [OFFEN] Ruhezeiten nachts

## Landingpage

Code liegt unter `landing/` (eigene Fly-App, Workflow `deploy-landing.yml`).

### Stufe 2 (Online-Buchung) – vor Go-live zu klären
- [ERLEDIGT 20.10.] AGB und Widerrufsbelehrung umgesetzt (`/agb`, `/widerruf`). Button-Hinweis: „Mit dem Klick auf PayPal geben Sie eine zahlungspflichtige, verbindliche Buchung ab“. Offen: Anwaltsprüfung, Online-Widerruf nach § 356a BGB
- [ERLEDIGT 20.10.] Preise brutto inkl. Umsatzsteuer (AGB Ziffer 8.1)
- [OFFEN] PayPal-Konto: Client-ID (`VITE_PAYPAL_CLIENT_ID`), Secrets `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`
- [OFFEN] Absenderadresse der Bestätigung (Platzhalter `booking@parkhandling.de`)
- [OFFEN] Zusatzleistungen (Aufbereitung) online buchbar?
- [OFFEN] Anbindung Park OS (API oder E-Mail)

### Stufe 1 – vor Go-live zu klären
- [OFFEN] Datenschutzerklärung (Seite `/datenschutz` ist Platzhalter)
- [OFFEN] Impressum: Betreiber, Anschrift, Vertretung, Kontakt, USt-ID (Seite `/impressum` ist Platzhalter)
- [OFFEN] Aufbewahrungsfrist für Anfragen (`inquiries`), v. a. für nicht umgewandelte oder abgelehnte Anfragen; danach Löschjob
- [OFFEN] Mail-Anbieter (Resend vorbereitet) und Auftragsverarbeitungsvertrag; erst danach Kundenbestätigung einschalten
- [OFFEN] Betriebsadresse für Anfrage-Benachrichtigungen (`settings.inquiry_notify_address`)
- [OFFEN] Domain der Landingpage und Absenderdomain der Mails
- [OFFEN] Preisliste (aktuell „auf Anfrage“)
- [OFFEN] Texte der Angebote (Halle, Außen, Shuttle, Aufbereitung) fachlich prüfen; aktuell vorläufige Formulierungen ohne konkrete Zusagen
- [OFFEN] Consent-Banner und Conversion-Tracking Google/Meta (eigenes Issue)
- [OFFEN] Ist eine Anfrage mit Abholung am selben Tag wie die Anreise nötig? (derzeit nicht möglich)
