# Rechner an das Dashboard anbinden

Ablauf für den Kunden: Jimdo → „Jetzt buchen“ → Rechner (`parkhandling-rechner.pplx.app`) → Buchung absenden.
Damit die Buchung zusätzlich im Dashboard erscheint, ruft der Rechner **vor** form.taxi und paypal.me einmal
die Edge Function `booking-checkout` mit der Aktion `register` auf.

```
Kunde klickt „Buchen“
  1. Rechner → booking-checkout (register)   → Buchung steht im Dashboard, Antwort: PF-Nummer + Betrag
  2. Rechner → form.taxi                     → Mail wie bisher, zusätzlich mit PF-Nummer und diesem Betrag
  3. Rechner → paypal.me/CarHandling/{Betrag}EUR
```

Schlägt Schritt 1 mit `422` fehl (Eingabe falsch, Bereich ausgebucht), zeigt der Rechner die Meldung an und
sendet **nicht** an form.taxi. So gibt es keine Mail-Buchung, die im Dashboard fehlt.

## Einbau im Rechner

Adresse und Schlüssel: Projekt-URL und anon key des Supabase-Projekts (beide öffentlich, sie stehen in
`landing/.env` als `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`).

```js
const SUPABASE_URL = 'https://<projekt>.supabase.co'
const SUPABASE_ANON_KEY = '<anon key>'

/** Meldet die Buchung an das Dashboard. Liefert { booking_ref, amount } oder wirft mit Meldung und Feldfehlern. */
async function registerBooking(form) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/booking-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action: 'register', form }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || 'Die Buchung konnte nicht gespeichert werden. Bitte erneut versuchen.')
    err.fields = data.fields || {} // z. B. { tariff_code: 'Die Halle ist im gewählten Zeitraum ausgebucht. …' }
    err.status = res.status
    throw err
  }
  return data // { booking_ref: 'PF-1A2B3C4D', amount: 64 }
}

// Beim Absenden:
async function onSubmit() {
  let booking
  try {
    booking = await registerBooking({
      arrival_date: '2026-12-01',   // YYYY-MM-DD
      arrival_time: '10:00',        // HH:MM
      pickup_date: '2026-12-07',     // 01.12. bis 07.12. = 7 Tage (Anreise- und Abreisetag zählen voll)
      pickup_time: '12:00',
      tariff_code: 'economy',       // economy | carcover | business | premium
      plate: 'M-AB 1234',
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max@example.com',
      phone: '+49 170 1234567',
      company: '',
      vehicle_model: '',
      fuel_type: '',                // combustion | electric | hybrid | ''
      persons: 2,
      return_mode: 'shuttle',       // shuttle | self
      flights: 'LH 2020 / LH 2021', // ein Feld wie im Rechner; fehlt es, wird es in der Notiz vermerkt
      child_seats: 0,               // 0 bis 5
      luggage: 2,                   // 0 bis 30
      notes: '',
      charging: false,
      charging_target: '',          // z. B. '80 %', nur mit charging: true
      language: 'de',               // de | en
      consent_privacy: true,
      consent_agb: true,
      consent_withdrawal: true,
      consent_early_start: true,    // optional; gibt es im Rechner nicht, dann weglassen
      website: '',                  // Honeypot, leer lassen
    })
  } catch (err) {
    showError(err.message, err.fields) // Meldung anzeigen, NICHT an form.taxi senden
    return
  }

  // form.taxi wie bisher, zusätzlich Buchungsnummer und Betrag des Servers mitsenden
  await sendToFormTaxi({ ...formularDaten, buchungsnummer: booking.booking_ref, betrag: booking.amount })

  // PayPal mit dem Betrag des Servers
  window.location.href = `https://paypal.me/CarHandling/${booking.amount.toFixed(2)}EUR`
}
```

Die vollständige Feldliste mit Grenzen und Pflichtangaben steht im `README.md`, Abschnitt „Website-Rechner“.

## Verfügbarkeit im Rechner anzeigen (optional)

```js
// { tariffs: [{ code: 'economy', available: true }, { code: 'space', available: false }, …], indoor_full: false }
// Hinweis: CarCover kommt hier als code 'space' zurück.
body: JSON.stringify({ action: 'availability', form: { arrival_date, arrival_time, pickup_date, pickup_time } })
```

## Prüfen nach dem Einbau

1. Im Rechner Economy, 7 Tage buchen → Antwort `amount: 64` und eine `PF-`Nummer.
2. In der App unter „Fahrzeuge“ steht die Buchung mit dem Kennzeichen **Website**, der PF-Nummer und Zahlung **Offen**.
3. Die form.taxi-Mail enthält dieselbe PF-Nummer und denselben Betrag.
4. Nach Zahlungseingang im Fahrzeug-Detail **Zahlung erhalten** drücken.

Erscheint im Browser ein CORS-Fehler, fehlt die Adresse des Rechners im Secret `BOOKING_ALLOWED_ORIGINS`.
