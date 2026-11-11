// Tests der reinen Buchungslogik (Deno: deno test --no-lock supabase/functions/booking-checkout/)
import { areaFullMessage, berlinToUtcIso, bookableDays, bookingRefFor, bookingRow, type BookingInput, chargingDescription, confirmationFailedMail, confirmationMail, formatBerlinDateTime, normalizeTariffCode, priceFor, registerRow, type TariffRow, validateBooking, validateLookup, validateWithdrawal, withdrawalMails } from './logic.ts'
import { bookingCorsHeaders, DEFAULT_BOOKING_ORIGINS, originAllowed, parseAllowedOrigins, withBookingCors } from '../_shared/cors.ts'

/** Buchungszeitpunkt passend zu „heute“ 20.10.2026 */
const NOW = '2026-10-20T08:00:00.000Z'

const tariff = (code: string, label: string, parking_type: TariffRow['parking_type'], base_price: number, extra_day_price: number, sort_order: number): TariffRow =>
  ({ code, label, parking_type, shuttle_text: 'x', included_text: 'x', base_price, extra_day_price, active: true, sort_order })

// Premium zuerst: bookingRow-Tests nutzen tariffs[0]
const tariffs: TariffRow[] = [
  tariff('premium', 'Premium', 'indoor', 98, 14, 4),
  tariff('economy', 'Economy', 'outdoor', 49, 7.5, 1),
  tariff('space', 'CarCover', 'outdoor_cover', 59, 9, 2),
  tariff('business', 'Business', 'indoor', 89, 12.5, 3),
]
const byCode = (code: string) => tariffs.find((t) => t.code === code)!

const base: BookingInput = {
  arrival_date: '2026-11-05', arrival_time: '10:00', pickup_date: '2026-11-12', pickup_time: '12:00',
  tariff_code: 'premium', plate: 'm-te 123', first_name: 'Test', last_name: 'Person', company: '',
  email: 'a@b.de', phone: '', vehicle_model: '', fuel_type: '', persons: 1, return_mode: 'shuttle',
  notes: '', consent_privacy: true, consent_agb: true, consent_withdrawal: true, consent_early_start: false,
  flight_outbound: 'LH 1234', flight_return: 'LH 1235', child_seats: 0, luggage: 2, website: '',
}

Deno.test('Buchbare Dauer: 5 bis 30 Tage', () => {
  if (bookableDays(4) || bookableDays(31) || bookableDays(5.5)) throw new Error('Grenzen falsch')
  if (!bookableDays(5) || !bookableDays(30)) throw new Error('Grenzen falsch')
})

Deno.test('Preismodell Website: Grundpreis bis 5 Tage + Preis je weiterem Tag', () => {
  // [Tarif, 5 Tage, 6 Tage, 14 Tage]
  const expected: [string, number, number, number][] = [
    ['economy', 49, 56.5, 116.5],
    ['space', 59, 68, 140],
    ['business', 89, 101.5, 201.5],
    ['premium', 98, 112, 224],
  ]
  for (const [code, d5, d6, d14] of expected) {
    const got = [5, 6, 14].map((d) => priceFor(byCode(code), d))
    if (got[0] !== d5 || got[1] !== d6 || got[2] !== d14) throw new Error(`${code}: ${got.join('/')}`)
  }
  // Akzeptanzkriterium: Economy, 7 Tage → 64,00 €
  if (priceFor(byCode('economy'), 7) !== 64) throw new Error('Economy 7 Tage')
  // Zahlen aus der Datenbank kommen als Text
  if (priceFor({ base_price: '49.00' as unknown as number, extra_day_price: '7.50' as unknown as number }, 7) !== 64) throw new Error('numeric als Text')
})

Deno.test('Betrag über validateBooking: Tage = Abholdatum − Anreisedatum, Uhrzeiten zählen nicht', () => {
  const at = (pickup_date: string, pickup_time = '12:00', tariff_code = 'economy') =>
    validateBooking({ ...base, tariff_code, pickup_date, pickup_time }, '2026-10-20', tariffs, NOW).value
  const d5 = at('2026-11-10'), d6 = at('2026-11-11'), d7 = at('2026-11-12'), d14 = at('2026-11-19')
  if (d5?.days !== 5 || d5.amount !== 49) throw new Error('5 Tage')
  if (d6?.days !== 6 || d6.amount !== 56.5) throw new Error('6 Tage')
  if (d7?.days !== 7 || d7.amount !== 64) throw new Error('7 Tage')
  if (d14?.days !== 14 || d14.amount !== 116.5) throw new Error('14 Tage')
  // Abholung früher oder später am Tag ändert die Tage nicht
  if (at('2026-11-12', '06:00')?.amount !== 64 || at('2026-11-12', '23:30')?.amount !== 64) throw new Error('Uhrzeit')
})

Deno.test('Über 30 Tage: Meldung ohne Monatstarif', () => {
  const r = validateBooking({ ...base, pickup_date: '2026-12-10' }, '2026-10-20', tariffs, NOW)
  if (r.value !== null || !r.errors.pickup_date || /Monatstarif/.test(r.errors.pickup_date)) throw new Error(JSON.stringify(r.errors))
})

Deno.test('Alias: carcover wird als space akzeptiert', () => {
  if (normalizeTariffCode('carcover') !== 'space' || normalizeTariffCode(' CarCover ') !== 'space' || normalizeTariffCode('premium') !== 'premium') throw new Error('Alias')
  const r = validateBooking({ ...base, tariff_code: 'carcover' }, '2026-10-20', tariffs, NOW)
  if (r.value?.tariff_code !== 'space' || r.value.amount !== 77) throw new Error(JSON.stringify(r))
  const unknown = validateBooking({ ...base, tariff_code: 'gold' }, '2026-10-20', tariffs, NOW)
  if (!unknown.errors.tariff_code) throw new Error('unbekannter Tarif')
})

Deno.test('Laden und Sprache: optional, Betrag bleibt unverändert', () => {
  const plain = validateBooking(base, '2026-10-20', tariffs, NOW).value!
  if (plain.charging !== false || plain.charging_target !== null || plain.language !== null) throw new Error('Standard')
  const r = validateBooking({ ...base, charging: true, charging_target: 80, language: 'EN' }, '2026-10-20', tariffs, NOW).value!
  if (!r.charging || r.charging_target !== '80 %' || r.language !== 'en') throw new Error(JSON.stringify(r))
  if (r.amount !== plain.amount) throw new Error('Betrag geändert')
  // Ladeziel ohne Ladewunsch wird verworfen
  if (validateBooking({ ...base, charging: false, charging_target: '80 %' }, '2026-10-20', tariffs, NOW).value!.charging_target !== null) throw new Error('Ziel ohne Laden')
  const bad = validateBooking({ ...base, language: 'fr', charging_target: 'x'.repeat(41) }, '2026-10-20', tariffs, NOW)
  if (!bad.errors.language || !bad.errors.charging_target) throw new Error(JSON.stringify(bad.errors))
  if (!chargingDescription(r).startsWith('Ladeziel: 80 % · Abrechnung bei Rückgabe')) throw new Error(chargingDescription(r))
})

Deno.test('register: Buchungszeile mit Quelle website, Zahlung offen und PF-Nummer', () => {
  const v = validateBooking({ ...base, tariff_code: 'economy', charging: true, charging_target: '80 %', language: 'de' }, '2026-10-20', tariffs, NOW).value!
  const id = '1a2b3c4d-1111-4222-8333-444455556666'
  const row = registerRow(v, byCode('economy'), id, '2026-10', NOW)
  if (row.id !== id || row.source !== 'website' || row.external_ref !== 'PF-1A2B3C4D' || row.external_ref !== bookingRefFor(id)) throw new Error('Kopf')
  if (row.status !== 'booked' || row.payment_status !== 'open' || row.price_total !== 64) throw new Error('Status/Betrag')
  if (row.tariff_code !== 'economy' || row.parking_type !== 'outdoor' || row.customer_language !== 'de') throw new Error('Tarif/Sprache')
  if (!row.notes.includes('AGB 2026-10 akzeptiert') || !row.notes.includes('Vorzeitiger Leistungsbeginn: ') || !row.notes.includes('Laden: ja · Ladeziel: 80 %')) throw new Error(row.notes)
})

Deno.test('Ausgebucht: Meldung nennt den Bereich', () => {
  if (!areaFullMessage('indoor').startsWith('Die Halle ist') || !areaFullMessage('outdoor_cover').includes('mit Plane') || !areaFullMessage('outdoor').startsWith('Der Außenbereich ist')) throw new Error('Text')
})

Deno.test('CORS: nur freigegebene Herkünfte, nie Stern', () => {
  if (parseAllowedOrigins(undefined) !== DEFAULT_BOOKING_ORIGINS || parseAllowedOrigins('  ') !== DEFAULT_BOOKING_ORIGINS) throw new Error('Standard')
  const list = parseAllowedOrigins('https://parkhandling-rechner.pplx.app, https://www.parkhandling.de/\nhttps://parkhandling.fly.dev')
  if (list.length !== 3 || list[1] !== 'https://www.parkhandling.de') throw new Error(list.join('|'))
  if (!originAllowed('https://parkhandling-rechner.pplx.app', list) || originAllowed('https://evil.example', list) || originAllowed(null, list)) throw new Error('Prüfung')
  // Teilstrings und andere Schemata zählen nicht
  if (originAllowed('https://parkhandling-rechner.pplx.app.evil.example', list) || originAllowed('http://www.parkhandling.de', list)) throw new Error('Teilstring')
  const ok = bookingCorsHeaders('https://parkhandling-rechner.pplx.app', list)
  if (ok['Access-Control-Allow-Origin'] !== 'https://parkhandling-rechner.pplx.app' || ok.Vary !== 'Origin' || !ok['Access-Control-Allow-Methods'].includes('OPTIONS')) throw new Error('erlaubt')
  if ('Access-Control-Allow-Origin' in bookingCorsHeaders('https://evil.example', list)) throw new Error('fremd')
  const res = withBookingCors(new Response('{}', { status: 422, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }), 'https://evil.example', list)
  if (res.headers.has('Access-Control-Allow-Origin') || res.status !== 422 || res.headers.get('Content-Type') !== 'application/json') throw new Error('Stern entfernt')
})

Deno.test('Zeitzone Berlin → UTC (Sommer- und Winterzeit)', () => {
  if (berlinToUtcIso('2026-10-20', '18:00') !== '2026-10-20T16:00:00.000Z') throw new Error('Sommerzeit')
  if (berlinToUtcIso('2026-01-10', '09:30') !== '2026-01-10T08:30:00.000Z') throw new Error('Winterzeit')
})

Deno.test('gültige Buchung berechnet Preis und normalisiert Kennzeichen', () => {
  const r = validateBooking(base, '2026-10-20', tariffs, NOW)
  if (!r.value || r.value.amount !== 126 || r.value.plate !== 'M-TE 123' || r.value.days !== 7) throw new Error(JSON.stringify(r))
})

Deno.test('unter 5 Tagen, Honeypot und fehlende Zustimmung werden abgelehnt', () => {
  const short = validateBooking({ ...base, pickup_date: '2026-11-09' }, '2026-10-20', tariffs, NOW)
  if (short.value !== null || !short.errors.pickup_date) throw new Error('kurz')
  const bot = validateBooking({ ...base, website: 'spam' }, '2026-10-20', tariffs, NOW)
  if (bot.value !== null || !bot.errors.website) throw new Error('honeypot')
  const noConsent = validateBooking({ ...base, consent_privacy: false }, '2026-10-20', tariffs, NOW)
  if (!noConsent.errors.consent_privacy) throw new Error('consent')
})

Deno.test('AGB-Zustimmung und Widerrufsbelehrung sind Pflicht', () => {
  const r = validateBooking({ ...base, consent_agb: false, consent_withdrawal: false }, '2026-10-20', tariffs, NOW)
  if (!r.errors.consent_agb || !r.errors.consent_withdrawal) throw new Error(JSON.stringify(r.errors))
})

Deno.test('Anreise innerhalb von 14 Tagen verlangt Zustimmung zum frühen Leistungsbeginn', () => {
  const soon = { ...base }
  const early = validateBooking({ ...soon, arrival_date: '2026-10-25', pickup_date: '2026-11-01' }, '2026-10-20', tariffs, NOW)
  if (!early.errors.consent_early_start) throw new Error('Zustimmung fehlt')
  const ok = validateBooking({ ...soon, arrival_date: '2026-10-25', pickup_date: '2026-11-01', consent_early_start: true }, '2026-10-20', tariffs, NOW)
  if (!ok.value || !ok.value.early_start) throw new Error('mit Zustimmung')
  const later = validateBooking({ ...base, arrival_date: '2026-11-20', pickup_date: '2026-11-28' }, '2026-10-20', tariffs, NOW)
  if (later.value?.early_start !== false || later.errors.consent_early_start) throw new Error('außerhalb der Frist')
})

Deno.test('Anreise frühestens 12 Stunden nach der Buchung', () => {
  // gebucht 20.10. 10:00 Berliner Zeit → frühestens 20.10. 22:00
  const sameDay = validateBooking({ ...base, arrival_date: '2026-10-20', arrival_time: '21:30', pickup_date: '2026-10-27', consent_early_start: true }, '2026-10-20', tariffs, NOW)
  if (!sameDay.errors.arrival_time || sameDay.errors.arrival_date) throw new Error(JSON.stringify(sameDay.errors))
  const ok = validateBooking({ ...base, arrival_date: '2026-10-20', arrival_time: '22:00', pickup_date: '2026-10-27', consent_early_start: true }, '2026-10-20', tariffs, NOW)
  if (!ok.value) throw new Error(JSON.stringify(ok.errors))
  // gebucht 20.10. 15:00 → frühestens 21.10. 03:00, der 20.10. ist als Datum zu früh
  const late = validateBooking({ ...base, arrival_date: '2026-10-20', arrival_time: '23:00', pickup_date: '2026-10-27', consent_early_start: true }, '2026-10-20', tariffs, '2026-10-20T13:00:00.000Z')
  if (!late.errors.arrival_date) throw new Error(JSON.stringify(late.errors))
})

Deno.test('Shuttle verlangt Flugnummern, Kindersitze auf 0 bis 5 begrenzt', () => {
  const noFlight = validateBooking({ ...base, flight_outbound: '', flight_return: '' }, '2026-10-20', tariffs, NOW)
  if (!noFlight.errors.flight_outbound || !noFlight.errors.flight_return) throw new Error('Flug')
  const seats = validateBooking({ ...base, child_seats: 6 }, '2026-10-20', tariffs, NOW)
  if (!seats.errors.child_seats) throw new Error('Kindersitze')
  if (!validateBooking({ ...base, child_seats: 5 }, '2026-10-20', tariffs, NOW).value) throw new Error('5 Kindersitze')
})

Deno.test('Bestätigungsmail nimmt die Buchung an und enthält AGB und Widerruf', () => {
  const r = validateBooking(base, '2026-10-20', tariffs, NOW)
  const m = confirmationMail({
    bookingRef: 'PF-TEST', booking: r.value!, tariffLabel: 'Premium', parkingLabel: 'Halle',
    agbText: 'AGB-TEXT', withdrawalText: 'WIDERRUF-TEXT', agbVersion: '2026-10',
  })
  if (!m.text.includes('nehmen wir Ihre Buchung verbindlich an')) throw new Error('Annahme fehlt')
  if (!m.text.includes('AGB-TEXT') || !m.text.includes('WIDERRUF-TEXT')) throw new Error('Texte fehlen')
})

Deno.test('Widerruf: Buchungsnummer, E-Mail und Bestätigung sind Pflicht', () => {
  const ok = { booking_ref: 'pf-1a2b3c4d', email: 'a@b.de', name: 'Test Person', reason: '', consent_withdraw: true, website: '' }
  if (Object.keys(validateWithdrawal(ok)).length !== 0) throw new Error('gültig abgelehnt')
  if (!validateWithdrawal({ ...ok, booking_ref: 'XYZ' }).booking_ref) throw new Error('Format')
  if (!validateWithdrawal({ ...ok, consent_withdraw: false }).consent_withdraw) throw new Error('Bestätigung')
  if (!validateWithdrawal({ ...ok, website: 'spam' }).website) throw new Error('honeypot')
})

Deno.test('Widerruf: Zeitpunkt in Berliner Ortszeit und Mail mit Eingangsbestätigung', () => {
  if (formatBerlinDateTime(new Date('2026-10-20T16:05:00Z')) !== '20.10.2026, 18:05 Uhr') throw new Error('Zeit')
  const m = withdrawalMails({
    bookingRef: 'PF-1A2B3C4D', customerName: 'Test Person', email: 'a@b.de', receivedAt: new Date('2026-10-20T16:05:00Z'),
    reason: null, withinPeriod: true, earlyStart: false,
  })
  if (!m.customer.text.includes('Eingegangen am: 20.10.2026, 18:05 Uhr')) throw new Error('Eingang fehlt')
  if (!m.customer.text.includes('Sie widerrufen den Vertrag')) throw new Error('Inhalt fehlt')
  if (!m.staff.subject.includes('PF-1A2B3C4D')) throw new Error('Betreff')
})

Deno.test('Bestätigung erneut anfordern: Prüfung der Eingaben', () => {
  if (Object.keys(validateLookup({ booking_ref: 'PF-1A2B3C4D', email: 'a@b.de', website: '' })).length !== 0) throw new Error('gültig abgelehnt')
  if (!validateLookup({ booking_ref: 'x', email: 'a@b.de', website: '' }).booking_ref) throw new Error('Ref')
  if (!validateLookup({ booking_ref: 'PF-1A2B3C4D', email: 'nein', website: '' }).email) throw new Error('Mail')
})

Deno.test('Hinweis an den Betrieb nennt Buchung und Fehler', () => {
  const m = confirmationFailedMail({ bookingRef: 'PF-1A2B3C4D', customerName: 'Max', email: 'a@b.de', amount: 148, error: 'Resend 500' })
  if (!m.subject.includes('NICHT versendet') || !m.text.includes('Resend 500')) throw new Error('Inhalt')
})

Deno.test('Buchungszeile: Tarif und Flugnummern in eigenen Feldern, nicht in der Notiz', () => {
  const v = validateBooking({ ...base, notes: 'Dachbox' }, '2026-10-20', tariffs, NOW).value!
  const row = bookingRow(v, tariffs[0], 'ORDER-1', '2026-10', NOW)
  if (row.tariff_code !== 'premium' || row.parking_type !== 'indoor') throw new Error('Tarif')
  if (row.flight_out !== 'LH1234' || row.flight_return !== 'LH1235') throw new Error(`Flüge ${row.flight_out}/${row.flight_return}`)
  if (row.notes.includes('Tarif') || row.notes.includes('Flug')) throw new Error('Notiz doppelt')
  if (!row.notes.startsWith('Dachbox\n') || !row.notes.includes('Vorzeitiger Leistungsbeginn: ')) throw new Error('Notiz')
  if (row.source !== 'landing' || row.payment_status !== 'paid' || row.external_ref !== 'ORDER-1') throw new Error('Kopf')
  const self = bookingRow({ ...v, return_mode: 'self' }, tariffs[0], 'ORDER-2', '2026-10', NOW)
  if (self.flight_out !== null || self.flight_return !== null) throw new Error('ohne Shuttle keine Flüge')
})
