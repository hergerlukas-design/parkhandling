# OFFENE FRAGEN – Park & Fly

Stand: 27.10.2026

**Worum es geht:** Park & Fly ist ein Parkservice am Flughafen München. Kunden geben ihr Auto vor
dem Flug bei uns ab, wir parken es, bringen sie per Shuttle zum Terminal und geben das Auto nach
der Rückkehr wieder aus. Auf Wunsch wird das Auto auch gereinigt oder geladen. Dafür gibt es zwei
Programme:

- **Die App** für unser Personal: Buchungen, Stellplätze, Aufgaben, Übergabeprotokolle, Shuttle.
- **Die Website (Landingpage)** für Kunden: Angebot ansehen, anfragen und online buchen und bezahlen.

Unten stehen die Fragen, die noch jemand beantworten oder entscheiden muss. Zu jeder Frage steht
kurz, warum sie wichtig ist und was bis zur Antwort gilt. Beantwortete Fragen kommen als [BELEGT]
nach `ANNAHMEN.md`; dort stehen auch alle vorläufigen Werte.

Legende: **[OFFEN]** = noch zu klären · **[ERLEDIGT]** = geklärt (ggf. mit Rest)

---

## App (für das Personal)

### Laden von Elektroautos

Wir laden E-Autos unserer Kunden an eigenen Ladesäulen des Herstellers Kempower. Die Säulen werden
über das Kempower-Portal „ChargEye“ verwaltet. Nach dem Laden tippt das Personal die geladenen kWh
in die App ein.

- [OFFEN] **Sollen vergessene Ladevorgänge automatisch erkannt werden?**
  Bricht eine Ladung ab und das Auto wird neu angesteckt, startet die Säule einen neuen Vorgang.
  Diesen vergisst das Personal leicht einzutragen. Die App könnte die Werte selbst bei Kempower
  abfragen; dafür brauchen wir einen Lesezugang zur Kempower-Schnittstelle.
  *Bis dahin:* Fehlende Werte werden von Hand aus ChargEye nachgetragen.
- [OFFEN] **Soll das Personal die Ladung direkt in der App starten und stoppen können?**
  Heute wird die Ladung an der Säule per Karte gestartet. Ob das über die App geht und welche
  Rechte wir dafür brauchen, muss mit Kempower geklärt werden.
- [OFFEN] **Brauchen wir eine Liste aller Ladungen für die Abrechnung?**
  Z. B. pro Auto: Kennzeichen, geladene kWh, Zeitraum, als Export nach Excel.
- [OFFEN] **Wie rechnen wir das Laden mit dem Kunden ab, pauschal oder pro kWh?**
  Wer pro kWh abrechnet, braucht in Deutschland geeichte Säulen (Eichrecht). Rechtlich prüfen
  lassen, ob unsere Säulen das erfüllen.

### Buchungen über das Portal Parkos

Ein Teil der Kunden bucht nicht bei uns direkt, sondern über das Vergleichsportal Parkos. Parkos
schickt uns pro Buchung eine E-Mail, die die App einlesen kann.

- [OFFEN] **Fragen an Parkos bzw. an uns:**
  - Steht die E-Mail-Adresse des Kunden in der Buchungsmail? (Sonst können wir ihm kein Protokoll schicken.)
  - Wie sehen die Mails bei Änderung oder Stornierung aus? Wir brauchen je ein Beispiel.
    *Bis dahin:* Solche Mails landen zur Prüfung bei einem Mitarbeiter.
  - Bietet Parkos statt Mails eine direkte Schnittstelle oder einen Export an?
  - Kommen weitere Portale dazu?
  - Bei welchem Anbieter liegt das Postfach, in dem die Mails ankommen, und dürfen wir es
    automatisch abrufen lassen? (Heute muss die Mail von Hand in die App gezogen werden.)

### Shuttle zum Flughafen

- [OFFEN] **Soll die App den Flugstatus abfragen?**
  Die Flugnummern der Kunden haben wir. Mit einer Abfrage bei einem Flugdaten-Dienst könnte die
  App Verspätungen erkennen und den Rückholtermin anpassen. Dafür müsste ein Dienst ausgewählt
  (und ggf. bezahlt) werden.

### Protokolle und E-Mails

Bei Abgabe und Rückgabe des Autos füllt das Personal ein Protokoll aus (Kilometerstand, Schäden,
Unterschrift). Daraus entsteht ein PDF.

- [OFFEN] **Sollen die Protokolle per E-Mail an den Kunden gehen?**
  Am 06.10.2026 zurückgestellt. Technisch ist alles vorbereitet; es fehlt nur ein Konto bei einem
  E-Mail-Versanddienst (vorgesehen: Resend). Ohne das funktionieren Protokolle und PDFs
  trotzdem, nur der Versand nicht.
- [OFFEN] **Wie lange bewahren wir Protokolle, Fotos und Kundendaten auf?**
  Wegen Datenschutz sollten Daten nach einer festen Frist gelöscht werden. Vorläufig: 365 Tage,
  automatisches Löschen ist aber noch ausgeschaltet.

### Benachrichtigungen aufs Handy

- [OFFEN] **Soll es nachts Ruhezeiten geben?**
  Das Personal bekommt Push-Meldungen (z. B. „Kunde kommt in 60 Minuten“). Sollen diese z. B.
  zwischen 23 und 5 Uhr stumm bleiben? Aktuell gibt es keine Ruhezeiten.

---

## Website für Kunden (Landingpage)

Die Website ist fertig programmiert, aber noch nicht online. (Technisch liegt der Code noch auf
dem Branch `claude/park-fly-landing-inquiry-uxo28c` und ist nicht in `main`.) Stufe 1 = Kunden
schicken eine Anfrage. Stufe 2 = Kunden buchen und bezahlen direkt online.

### Online-Buchung mit Bezahlung – vor dem Start zu klären

- [ERLEDIGT 20.10.] **AGB und Widerrufsbelehrung** sind auf der Website eingebaut. Der Kunde muss
  vor dem Bezahlen zustimmen.
  *Noch offen:* Ein Anwalt sollte die Texte prüfen. Außerdem fehlt die Möglichkeit, online zu
  widerrufen (gesetzliche Pflicht nach § 356a BGB).
- [ERLEDIGT 20.10.] **Preise** werden inklusive Mehrwertsteuer angezeigt.
- [OFFEN] **PayPal-Geschäftskonto:** Bezahlt wird über PayPal. Wir brauchen ein PayPal-Geschäftskonto
  und daraus die Zugangsdaten für die Website (für Entwickler: Client-ID und Client-Secret).
- [OFFEN] **Von welcher E-Mail-Adresse bekommt der Kunde seine Buchungsbestätigung?**
  Vorläufig: `booking@parkhandling.de`.
- [OFFEN] **Sollen Kunden Extras wie Autoreinigung gleich online mitbuchen können?**
  Aktuell nicht; Wünsche können nur als Anmerkung eingetragen werden.
- [OFFEN] **Wie kommen Buchungen über Parkos und Buchungen über unsere Website zusammen?**
  Gilt die Online-Bezahlung nur für Buchungen über unsere Website, und wie werden Parkos-Buchungen
  angebunden (Schnittstelle oder E-Mail, siehe oben)?

### Anfrage-Formular und Pflichtangaben – vor dem Start zu klären

- [OFFEN] **Datenschutzerklärung:** Gesetzlich Pflicht. Die Seite ist noch ein Platzhalter; der Text
  muss geschrieben bzw. geprüft werden.
- [OFFEN] **Impressum:** Gesetzlich Pflicht. Wir brauchen Firmenname, Anschrift, wer die Firma
  vertritt, Telefon/E-Mail und Umsatzsteuer-ID.
- [OFFEN] **Wie lange speichern wir Anfragen?** Vor allem Anfragen, aus denen keine Buchung wird,
  sollten nach einer festen Frist gelöscht werden (Datenschutz). Welche Frist?
- [OFFEN] **Welcher Dienst verschickt die E-Mails?** Vorgesehen ist Resend. Mit dem Anbieter muss ein
  Vertrag zur Auftragsverarbeitung abgeschlossen werden (Datenschutz). Erst danach bekommen
  Kunden eine Eingangsbestätigung per Mail.
- [OFFEN] **An welche E-Mail-Adresse sollen neue Anfragen gemeldet werden?** (Unser Postfach im Betrieb.)
- [OFFEN] **Unter welcher Internetadresse läuft die Website**, und von welcher Domain gehen die Mails
  raus?
- [OFFEN] **Preisliste:** Auf der Website steht derzeit „Preis auf Anfrage“. Sollen konkrete Preise
  angezeigt werden, und welche?
- [OFFEN] **Angebotstexte prüfen:** Die Beschreibungen (Hallenparkplatz, Außenparkplatz, Shuttle,
  Autoreinigung) sind vorläufig formuliert und versprechen bewusst nichts Konkretes. Bitte
  fachlich prüfen und ergänzen.
- [OFFEN] **Cookie-Banner und Werbe-Tracking:** Wollen wir messen, wie viele Buchungen über Google- bzw.
  Facebook/Instagram-Werbung kommen? Dann braucht die Website ein Cookie-Banner zur Einwilligung.
- [OFFEN] **Abgabe und Abholung am selben Tag:** Soll ein Kunde sein Auto am selben Tag bringen und
  wieder abholen können (z. B. Tagesausflug)? Derzeit ist das im Formular nicht möglich.
