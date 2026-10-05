# ANNAHMEN – Park & Fly Prototyp

Stand: 05.10.2026 · Diese Datei gehört ins Repo-Root und wird bei jeder geklärten Frage aktualisiert.

Legende: **[BELEGT]** = aus Gespräch oder Excel-Vorlage bestätigt · **[ANNAHME]** = Platzhalter, später anpassen · **[OFFEN]** = bewusst nicht umgesetzt

Alle Werte mit [ANNAHME] liegen als Seed-Daten oder in `settings` und sind ohne Code-Änderung anpassbar.

## Betrieb
- [BELEGT] Standort: Park & Fly Flughafen München
- [BELEGT] Ca. 100–120 Stellplätze, davon ca. 25 Indoor (Premium)
- [BELEGT] Indoor-Regale abhängig, 3 Ebenen; frühe Abholung unten
- [ANNAHME] Halle: 8 Regalspalten × 3 Ebenen = 24 Plätze (R1–R8, E1–E3)
- [ANNAHME] Außen A (mit Abdeckplane): 2 Reihen × 24 Plätze (A1, A2)
- [ANNAHME] Außen B (ohne Plane): 2 Reihen × 24 Plätze (B1, B2)
- [ANNAHME] Arbeitsorte: Aufbereitung 1, Aufbereitung 2, Ladeplatz 1–2, Pufferzone (3 Plätze), Übergabezone
- [ANNAHME] Schlüssel: Tresor mit Fächern K-001 bis K-150

## Leistungen
- [BELEGT] Leistungsarten laut Excel: Park & Fly, Premium-Stellplatz, Fahrzeugpflege/Aufbereitung, Hol- & Bringservice, Transfer Flughafen, Zusatzleistung
- [BELEGT] Grundreinigung bei jeder Buchung; Aufbereitung in Teilschritten
- [BELEGT] Preise werden derzeit manuell bzw. individuell vereinbart
- [ANNAHME] Katalog: Grundreinigung (Standard), Aufbereitung innen, Aufbereitung außen, Politur, Laden, Tanken, Servicearbeiten, Zusatzleistung (Freitext)
- [ANNAHME] Preise im Katalog leer (`null`); Gesamtpreis pro Buchung manuell eintragbar

## Buchungen
- [BELEGT] Zeitraum von Datum/Uhrzeit bis Datum/Uhrzeit, Umbuchungen möglich
- [BELEGT] Stornierte Buchungen werden nicht gelöscht, sondern auf „storniert" gesetzt
- [BELEGT] Felder laut Excel: Buchungs-Nr., Eingang am, Status, Kunde/Firma, Telefon, E-Mail, Kennzeichen, Leistung, Anreise, Abholung, Anzahl Tage, Parkplatz, Aufbereitung, Hol- & Bringservice, Transfer, Preis, Zahlungsstatus, Notizen
- [ANNAHME] Buchungsquelle im Prototyp: manuelles Anlegen + Excel-/CSV-Import im Format der Vorlage „ParkHandling_Buchungsliste" + Demo-Daten
- [ANNAHME] Zahlungsstatus: offen, teilweise, bezahlt, erstattet (nur Anzeige, keine Zahlungsabwicklung)
- [OFFEN] Anbindung des echten Buchungsportals

## Shuttle & Transfer
- [BELEGT] Shuttle stündlich innerhalb von Betriebszeiten, Premium auf Abruf
- [ANNAHME] Betriebszeiten 05:00–23:00, Takt 60 min, 1 Bus mit 8 Plätzen
- [ANNAHME] „Hol- & Bringservice" (Excel) = Fahrzeug wird beim Kunden abgeholt/zurückgebracht → eigener `return_mode` `pickup_delivery`, getrennt vom Vallet am Terminal
- [OFFEN] Flugstatus-Abfrage

## Protokolle & Mails
- [BELEGT] Unterschrift bei Annahme und Übergabe, Layout aus Vehicle Protocol Pro V2
- [ANNAHME] Im Prototyp gehen alle Mails nur an eine Testadresse aus `settings`
- [OFFEN] Aufbewahrungsfrist (Platzhalter in `settings`: 365 Tage, Löschjob deaktiviert)

## Nutzer & Geräte
- [ANNAHME] Rollen: `staff` und `admin`
- [ANNAHME] Login per E-Mail + Passwort (Supabase Auth), PIN-Login später
- [ANNAHME] Geräte: Android-/iOS-Tablets quer und Smartphones, Chrome/Safari aktuell

## Technik
- [ANNAHME] Supabase-Region EU (Frankfurt)
- [ANNAHME] Nur Testdaten bis Datenschutz und Hosting geklärt sind
