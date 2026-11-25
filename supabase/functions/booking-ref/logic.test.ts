// Tests der Zuordnung (Deno: deno test supabase/functions/booking-ref/)
import { berlinDate, refRequest, validRef } from './logic.ts'

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}: erwartet ${e}, erhalten ${a}`)
}

Deno.test('Kürzel wie im Rechner', () => {
  eq(refRequest({ id: 'x', start_at: '2026-12-20T08:00:00Z', tariff_code: 'economy', return_mode: 'shuttle' }),
    { arrival_date: '2026-12-20', tariff: 'OEC', service: 'SH', reference: 'x' }, 'OEC/SH')
  eq(refRequest({ id: 'x', start_at: '2026-12-20T08:00:00Z', tariff_code: 'space', return_mode: 'self' }), { arrival_date: '2026-12-20', tariff: 'OE+', service: 'SE', reference: 'x' }, 'Economy +')
  eq(refRequest({ id: 'x', start_at: '2026-12-20T08:00:00Z', tariff_code: 'business', return_mode: 'pickup_delivery' }),
    { arrival_date: '2026-12-20', tariff: 'IB', service: 'VA', reference: 'x' }, 'IB/VA')
  eq(refRequest({ id: 'x', start_at: '2026-12-20T08:00:00Z', tariff_code: 'premium', return_mode: 'shuttle' }), { arrival_date: '2026-12-20', tariff: 'IP', service: 'SH', reference: 'x' }, 'Premium')
})

Deno.test('Ohne Tarif keine Nummer', () => {
  eq('error' in refRequest({ id: 'x', start_at: '2026-12-20T08:00:00Z', tariff_code: null, return_mode: 'shuttle' }), true, 'kein Tarif')
})

Deno.test('Anreisetag in Berliner Zeit', () => {
  eq(berlinDate('2026-12-19T23:30:00Z'), '2026-12-20', '00:30 Uhr Berlin zählt zum 20.')
  eq(berlinDate('2026-07-01T21:59:00Z'), '2026-07-01', 'Sommerzeit')
})

Deno.test('Antwort prüfen', () => {
  eq(validRef('PH261220-OE+-SE-002'), true, 'gültig')
  eq(validRef('PH261220-IB-VA-003'), true, 'gültig')
  eq(validRef('PF-7650A892'), false, 'altes Format')
  eq(validRef(null), false, 'leer')
})
