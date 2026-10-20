// Tests der reinen Buchungslogik (Deno: deno test --no-lock supabase/functions/booking-checkout/)
import { berlinToUtcIso, type BookingInput, type TariffRow, tierForDays, validateBooking } from './logic.ts'

const tariffs: TariffRow[] = [
  {
    code: 'premium', label: 'Premium', parking_type: 'indoor', shuttle_text: 'Direkt', included_text: 'x',
    price_week: 148, price_holiday: 249, price_month: 369, active: true, sort_order: 4,
  },
]

const base: BookingInput = {
  arrival_date: '2026-11-01', arrival_time: '10:00', pickup_date: '2026-11-08', pickup_time: '12:00',
  tariff_code: 'premium', plate: 'm-te 123', first_name: 'Test', last_name: 'Person', company: '',
  email: 'a@b.de', phone: '', vehicle_model: '', fuel_type: '', persons: 1, return_mode: 'shuttle',
  notes: '', consent_privacy: true, website: '',
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
  const short = validateBooking({ ...base, pickup_date: '2026-11-04' }, '2026-10-20', tariffs)
  if (short.value !== null || !short.errors.pickup_date) throw new Error('kurz')
  const bot = validateBooking({ ...base, website: 'spam' }, '2026-10-20', tariffs)
  if (bot.value !== null || !bot.errors.website) throw new Error('honeypot')
  const noConsent = validateBooking({ ...base, consent_privacy: false }, '2026-10-20', tariffs)
  if (!noConsent.errors.consent_privacy) throw new Error('consent')
})
