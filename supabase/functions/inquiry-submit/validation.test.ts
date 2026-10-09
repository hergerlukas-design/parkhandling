// deno test supabase/functions/inquiry-submit
import * as assert from 'jsr:@std/assert@1'
import { formatDateDE, isIsoDate, LIMITS, todayInBerlin, validateInquiry } from './validation.ts'

const TODAY = '2026-10-09'
const base = {
  arrival_date: '2026-10-09',
  pickup_date: '2026-10-10',
  parking_type: 'any',
  plate: 'M-AB 1',
  first_name: 'Test',
  last_name: 'Person',
  email: 'a@example.com',
  consent_privacy: true,
}
const errorsOf = (o: Record<string, unknown>) => {
  const r = validateInquiry({ ...base, ...o }, TODAY)
  return r.ok ? {} : r.errors
}

Deno.test('Mindestangaben genügen; Anreise heute erlaubt', () => {
  const r = validateInquiry(base, TODAY)
  assert.assert(r.ok)
})

Deno.test('Datumslogik', () => {
  assert.assert(errorsOf({ arrival_date: '2026-10-08' }).arrival_date, 'Vergangenheit')
  assert.assert(errorsOf({ pickup_date: '2026-10-09' }).pickup_date, 'Abholung = Anreise')
  assert.assert(errorsOf({ arrival_date: '2027-10-11', pickup_date: '2027-10-12' }).arrival_date, 'mehr als 1 Jahr')
  assert.assert(errorsOf({ arrival_date: '09.10.2026' }).arrival_date, 'falsches Format')
  assert.assert(!isIsoDate('2026-02-30'))
})

Deno.test('Pflichtfelder, E-Mail, Maximallängen', () => {
  const e = errorsOf({ plate: ' ', first_name: '', last_name: '', email: '', parking_type: 'dach', consent_privacy: 'ja' })
  assert.assertEquals(Object.keys(e).sort(), ['consent_privacy', 'email', 'first_name', 'last_name', 'parking_type', 'plate'])
  assert.assert(errorsOf({ email: 'a@b' }).email)
  assert.assert(errorsOf({ plate: 'X'.repeat(LIMITS.plate + 1) }).plate)
  assert.assert(errorsOf({ message: 'x'.repeat(LIMITS.message + 1) }).message)
  assert.assert(!errorsOf({ message: 'x'.repeat(LIMITS.message) }).message)
  assert.assert(errorsOf({ phone: 'abc' }).phone)
  assert.assert(errorsOf({ services: ['valet'] }).services)
})

Deno.test('UTM-Werte werden gekürzt statt abgelehnt', () => {
  const r = validateInquiry({ ...base, utm: { utm_source: 'x'.repeat(300) } }, TODAY)
  assert.assert(r.ok && r.value.utm_source?.length === LIMITS.utm)
})

Deno.test('Zeitzone Europe/Berlin und deutsches Datumsformat', () => {
  // 23:30 UTC am 09.10. ist in Berlin (MESZ) bereits der 10.10.
  assert.assertEquals(todayInBerlin(new Date('2026-10-09T23:30:00Z')), '2026-10-10')
  assert.assertEquals(formatDateDE('2026-10-12'), '12.10.2026')
})
