// Tests der reinen Buchungslogik (Deno: deno test --no-lock supabase/functions/booking-checkout/)
import { berlinToUtcIso, type BookingInput, confirmationMail, type TariffRow, tierForDays, validateBooking } from './logic.ts'

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
  const r = validateBooking(base, '2026-10-20', tariffs)
  if (!r.value || r.value.amount !== 148 || r.value.plate !== 'M-TE 123' || r.value.days !== 7) throw new Error(JSON.stringify(r))
})

Deno.test('unter 5 Tagen, Honeypot und fehlende Zustimmung werden abgelehnt', () => {
  const short = validateBooking({ ...base, pickup_date: '2026-11-09' }, '2026-10-20', tariffs)
  if (short.value !== null || !short.errors.pickup_date) throw new Error('kurz')
  const bot = validateBooking({ ...base, website: 'spam' }, '2026-10-20', tariffs)
  if (bot.value !== null || !bot.errors.website) throw new Error('honeypot')
  const noConsent = validateBooking({ ...base, consent_privacy: false }, '2026-10-20', tariffs)
  if (!noConsent.errors.consent_privacy) throw new Error('consent')
})

Deno.test('AGB-Zustimmung und Widerrufsbelehrung sind Pflicht', () => {
  const r = validateBooking({ ...base, consent_agb: false, consent_withdrawal: false }, '2026-10-20', tariffs)
  if (!r.errors.consent_agb || !r.errors.consent_withdrawal) throw new Error(JSON.stringify(r.errors))
})

Deno.test('Anreise innerhalb von 14 Tagen verlangt Zustimmung zum frühen Leistungsbeginn', () => {
  const soon = { ...base }
  const early = validateBooking({ ...soon, arrival_date: '2026-10-25', pickup_date: '2026-11-01' }, '2026-10-20', tariffs)
  if (!early.errors.consent_early_start) throw new Error('Zustimmung fehlt')
  const ok = validateBooking({ ...soon, arrival_date: '2026-10-25', pickup_date: '2026-11-01', consent_early_start: true }, '2026-10-20', tariffs)
  if (!ok.value || !ok.value.early_start) throw new Error('mit Zustimmung')
  const later = validateBooking({ ...base, arrival_date: '2026-11-20', pickup_date: '2026-11-28' }, '2026-10-20', tariffs)
  if (later.value?.early_start !== false || later.errors.consent_early_start) throw new Error('außerhalb der Frist')
})

Deno.test('Shuttle verlangt Flugnummern, Kindersitze auf 0 bis 3 begrenzt', () => {
  const noFlight = validateBooking({ ...base, flight_outbound: '', flight_return: '' }, '2026-10-20', tariffs)
  if (!noFlight.errors.flight_outbound || !noFlight.errors.flight_return) throw new Error('Flug')
  const seats = validateBooking({ ...base, child_seats: 4 }, '2026-10-20', tariffs)
  if (!seats.errors.child_seats) throw new Error('Kindersitze')
})

Deno.test('Bestätigungsmail nimmt die Buchung an und enthält AGB und Widerruf', () => {
  const r = validateBooking(base, '2026-10-20', tariffs)
  const m = confirmationMail({
    bookingRef: 'PF-TEST', booking: r.value!, tariffLabel: 'Premium', parkingLabel: 'Halle',
    agbText: 'AGB-TEXT', withdrawalText: 'WIDERRUF-TEXT', agbVersion: '2026-10',
  })
  if (!m.text.includes('nehmen wir Ihre Buchung verbindlich an')) throw new Error('Annahme fehlt')
  if (!m.text.includes('AGB-TEXT') || !m.text.includes('WIDERRUF-TEXT')) throw new Error('Texte fehlen')
})
