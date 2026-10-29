// Tests der reinen Buchungslogik (Deno: deno test --no-lock supabase/functions/booking-checkout/)
import { berlinToUtcIso, bookingRow, type BookingInput, confirmationFailedMail, confirmationMail, formatBerlinDateTime, type TariffRow, tierForDays, validateBooking, validateLookup, validateWithdrawal, withdrawalMails } from './logic.ts'

/** Buchungszeitpunkt passend zu „heute“ 20.10.2026 */
const NOW = '2026-10-20T08:00:00.000Z'

const tariffs: TariffRow[] = [
  {
    code: 'premium', label: 'Premium', parking_type: 'indoor', shuttle_text: 'Direkt', included_text: 'x',
    price_week: 148, price_holiday: 249, price_month: 369, active: true, sort_order: 4,
  },
]

const base: BookingInput = {
  arrival_date: '2026-11-05', arrival_time: '10:00', pickup_date: '2026-11-12', pickup_time: '12:00',
  tariff_code: 'premium', plate: 'm-te 123', first_name: 'Test', last_name: 'Person', company: '',
  email: 'a@b.de', phone: '', vehicle_model: '', fuel_type: '', persons: 1, return_mode: 'shuttle',
  notes: '', consent_privacy: true, consent_agb: true, consent_withdrawal: true, consent_early_start: false,
  flight_outbound: 'LH 1234', flight_return: 'LH 1235', child_seats: 0, luggage: 2, website: '',
}

Deno.test('Dauerklassen', () => {
  if (tierForDays(4) !== null || tierForDays(31) !== null) throw new Error('Grenzen falsch')
  if (tierForDays(5) !== 'week' || tierForDays(9) !== 'holiday' || tierForDays(16) !== 'month') throw new Error('Klassen falsch')
})

Deno.test('Zeitzone Berlin → UTC (Sommer- und Winterzeit)', () => {
  if (berlinToUtcIso('2026-10-20', '18:00') !== '2026-10-20T16:00:00.000Z') throw new Error('Sommerzeit')
  if (berlinToUtcIso('2026-01-10', '09:30') !== '2026-01-10T08:30:00.000Z') throw new Error('Winterzeit')
})

Deno.test('gültige Buchung berechnet Preis und normalisiert Kennzeichen', () => {
  const r = validateBooking(base, '2026-10-20', tariffs, NOW)
  if (!r.value || r.value.amount !== 148 || r.value.plate !== 'M-TE 123' || r.value.days !== 7) throw new Error(JSON.stringify(r))
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

Deno.test('Shuttle verlangt Flugnummern, Kindersitze auf 0 bis 3 begrenzt', () => {
  const noFlight = validateBooking({ ...base, flight_outbound: '', flight_return: '' }, '2026-10-20', tariffs, NOW)
  if (!noFlight.errors.flight_outbound || !noFlight.errors.flight_return) throw new Error('Flug')
  const seats = validateBooking({ ...base, child_seats: 4 }, '2026-10-20', tariffs, NOW)
  if (!seats.errors.child_seats) throw new Error('Kindersitze')
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
