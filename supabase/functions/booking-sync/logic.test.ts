// Tests der Zuordnung (Deno: deno test --no-lock supabase/functions/booking-sync/)
import { flights, mapRecord, secretMatches, unwrapPayload } from './logic.ts'

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}: erwartet ${e}, erhalten ${a}`)
}

// Datensatz im Format des Rechner-Formulars (wie action 'register')
const formRecord = {
  id: '6f1c…',
  booking_ref: 'PF-1A2B3C4D',
  created_at: '2026-11-20T10:15:00Z',
  arrival_date: '01.12.2026',
  arrival_time: '9:00',
  pickup_date: '2026-12-07',
  pickup_time: '12:00 Uhr',
  tariff_code: 'carcover',
  plate: 'm-ab 1234',
  first_name: 'Max',
  last_name: 'Mustermann',
  email: 'Max@Example.com',
  phone: '+49 170 1234567',
  persons: 2,
  return_mode: 'shuttle',
  flights: 'LH 2020 / LH 2021',
  child_seats: 1,
  luggage: 2,
  amount: 64,
  payment_status: 'succeeded',
  checkin_token: '0123456789abcdef0123456789abcdef',
  language: 'de',
}

Deno.test('Rechner-Format: alle Felder zugeordnet', () => {
  const r = mapRecord(formRecord, false)
  eq(r.error, null, 'kein Fehler')
  eq(r.external_ref, 'PF-1A2B3C4D', 'Buchungsnummer vor id')
  eq(r.tariff_code, 'space', 'CarCover heißt bei uns space')
  eq(r.booking.customer_name, 'Max Mustermann', 'Name')
  eq(r.booking.plate, 'M-AB 1234', 'Kennzeichen groß')
  eq(r.booking.customer_email, 'max@example.com', 'E-Mail klein')
  eq(r.booking.start_at, '2026-12-01T08:00:00.000Z', 'Anreise Berliner Winterzeit')
  eq(r.booking.end_at, '2026-12-07T11:00:00.000Z', 'Abholung mit „Uhr“')
  eq([r.booking.flight_out, r.booking.flight_return], ['LH2020', 'LH2021'], 'Flüge aus einem Feld')
  eq(r.booking.price_total, 64, 'Betrag')
  eq(r.booking.payment_status, 'paid', 'Stripe succeeded → bezahlt')
  eq(r.booking.customer_language, 'de', 'Sprache')
  eq(r.booking.parking_type, undefined, 'Stellplatzart kommt in der Datenbank aus dem Tarif')
  const notes = String(r.booking.notes)
  if (!notes.includes('Kindersitze: 1 · Gepäckstücke: 2')) throw new Error('Kindersitze/Gepäck in Notiz')
  if (!notes.includes('ticket.html#0123456789abcdef0123456789abcdef')) throw new Error('Ticket-Link in Notiz')
})

Deno.test('Format unserer Tabelle bookings', () => {
  const r = mapRecord({
    external_ref: 'PF-99', customer_name: 'Erika Muster', plate: 'M-EM 1', start_at: '2026-12-01T10:00:00+01:00',
    end_at: '2026-12-05T10:00:00+01:00', parking_type: 'indoor', tariff_code: 'premium', payment_status: 'open',
    flight_out: 'lh 1', flight_return: 'lh 2', fuel_type: 'electric', return_mode: 'valet',
  }, false)
  eq(r.error, null, 'kein Fehler')
  eq(r.booking.start_at, '2026-12-01T09:00:00.000Z', 'ISO mit Offset')
  eq(r.booking.parking_type, 'indoor', 'Stellplatzart übernommen')
  eq(r.booking.fuel_type, 'electric', 'Antrieb')
  eq(r.booking.return_mode, 'pickup_delivery', 'Valet → Hol- & Bringservice')
  eq(r.booking.payment_status, 'open', 'offen')
})

Deno.test('ISO ohne Zeitzone gilt als Berliner Zeit', () => {
  const r = mapRecord({ id: 'x', customer_name: 'A', plate: 'B', arrival_at: '2026-07-01T10:00', pickup_at: '2026-07-03T10:00', tariff: 'Economy' }, false)
  eq(r.booking.start_at, '2026-07-01T08:00:00.000Z', 'Sommerzeit')
  eq(r.tariff_code, 'economy', 'Tarif aus „tariff“, Groß/klein egal')
})

Deno.test('Pflichtangaben fehlen → Fehler, keine Felder', () => {
  const r = mapRecord({ booking_ref: 'PF-1', first_name: 'A', arrival_date: '2026-12-01' }, false)
  eq(r.error, 'Pflichtangaben fehlen: Kennzeichen, Anreise, Abholung, Tarif oder Stellplatzart', 'Fehlerliste')
  eq(r.external_ref, 'PF-1', 'Nummer für die Prüfliste')
})

Deno.test('Ohne Buchungsnummer kein Abgleich möglich', () => {
  eq(mapRecord({ customer_name: 'A' }, false).error, 'Buchungsnummer fehlt (booking_ref, external_ref oder id)', 'Fehler')
})

Deno.test('Storno: Status, cancelled_at oder DELETE', () => {
  for (const [rec, del] of [[{ id: 'a', status: 'canceled' }, false], [{ id: 'a', cancelled_at: '2026-11-01' }, false], [{ id: 'a' }, true]] as const) {
    const r = mapRecord(rec, del)
    eq(r.event, 'cancel', 'Storno erkannt')
    eq(r.booking, { external_ref: 'a', cancelled: true }, 'nur Storno, keine anderen Felder')
    eq(r.error, null, 'Storno braucht keine Pflichtfelder')
  }
})

Deno.test('Zahlung: paid_at bzw. paid = true → bezahlt; unbekannt → nichts', () => {
  const base = { id: 'a', customer_name: 'A', plate: 'B', start_at: '2026-12-01T10:00:00Z', end_at: '2026-12-02T10:00:00Z', parking_type: 'outdoor' }
  eq(mapRecord({ ...base, paid_at: '2026-11-20T10:00:00Z' }, false).booking.payment_status, 'paid', 'paid_at')
  eq(mapRecord({ ...base, paid: true }, false).booking.payment_status, 'paid', 'paid')
  eq(mapRecord(base, false).booking.payment_status, undefined, 'ohne Angabe')
})

Deno.test('Webhook-Hülle', () => {
  eq(unwrapPayload({ type: 'INSERT', table: 'bookings', record: { id: 1 }, old_record: null }), { record: { id: 1 }, deleted: false }, 'INSERT')
  eq(unwrapPayload({ type: 'DELETE', record: null, old_record: { id: 1 } }), { record: { id: 1 }, deleted: true }, 'DELETE')
  eq(unwrapPayload({ booking: { id: 2 } }), { record: { id: 2 }, deleted: false }, 'direkt')
  eq('error' in unwrapPayload([]), true, 'Array abgelehnt')
  eq('error' in unwrapPayload({ type: 'UPDATE' }), true, 'ohne record')
})

Deno.test('Flüge: getrennte Felder haben Vorrang', () => {
  eq(flights({ flight_outbound: 'ew 1', flights: 'LH 1 / LH 2' }), ['EW1', null], 'getrennt')
  eq(flights({ flights: 'LH 1' }), ['LH1', null], 'nur Hinflug')
})

Deno.test('Geheimnis: gleich, ungleich, zu kurz', () => {
  const s = 'a'.repeat(32)
  eq(secretMatches(s, s), true, 'gleich')
  eq(secretMatches(s + 'x', s), false, 'länger')
  eq(secretMatches('b'.repeat(32), s), false, 'anders')
  eq(secretMatches(null, s), false, 'fehlt')
  eq(secretMatches('kurz', 'kurz'), false, 'zu kurzes Secret nie gültig')
})
