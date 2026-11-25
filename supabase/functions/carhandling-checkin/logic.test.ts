// Tests (Deno: deno test --no-lock supabase/functions/carhandling-checkin/)
import { pendingRequests, stateFromResponse, type CheckinBooking } from './logic.ts'

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}: erwartet ${e}, erhalten ${a}`)
}

const base: CheckinBooking = {
  id: 'b1',
  external_ref: 'PH261215-OEC-SH-002',
  status: 'stored',
  carhandling_checked_in_at: null,
  carhandling_checked_out_at: null,
  protocols: [],
}
const intake = { type: 'intake', status: 'final', finalized_at: '2026-12-15T08:05:00Z' }
const handover = { type: 'handover', status: 'final', finalized_at: '2026-12-20T17:00:00Z' }

Deno.test('Annahme melden, wenn CarHandling sie noch nicht hat', () => {
  eq(pendingRequests({ ...base, protocols: [intake] }), [
    { booking_ref: 'PH261215-OEC-SH-002', op: 'checkin', at: '2026-12-15T08:05:00Z' },
  ], 'checkin')
  eq(pendingRequests({ ...base, protocols: [{ ...intake, status: 'draft' }] }), [], 'Entwurf zählt nicht')
  eq(pendingRequests({ ...base, protocols: [intake], carhandling_checked_in_at: '2026-12-15T08:06:00Z' }), [], 'schon gemeldet')
})

Deno.test('Rückgabe nach der Annahme', () => {
  eq(pendingRequests({ ...base, protocols: [intake, handover] }).map((r) => r.op), ['checkin', 'checkout'], 'beide, Reihenfolge')
  eq(pendingRequests({ ...base, protocols: [intake, handover], carhandling_checked_in_at: 'x' }).map((r) => r.op), ['checkout'], 'nur Rückgabe')
})

Deno.test('Keine Meldung ohne Buchungsnummer oder bei Storno', () => {
  eq(pendingRequests({ ...base, external_ref: null, protocols: [intake] }), [], 'ohne Nummer')
  eq(pendingRequests({ ...base, status: 'cancelled', protocols: [intake] }), [], 'storniert')
})

Deno.test('Antwort übernehmen', () => {
  const req = { booking_ref: 'X', op: 'checkin' as const, at: '2026-12-15T08:05:00Z' }
  eq(stateFromResponse(req, { checked_in_at: '2026-12-15T08:00:00Z' }), { carhandling_checked_in_at: '2026-12-15T08:00:00.000Z' }, 'Zeitpunkt von CarHandling')
  eq(stateFromResponse(req, {}), { carhandling_checked_in_at: '2026-12-15T08:05:00.000Z' }, 'sonst unserer')
  eq(stateFromResponse({ ...req, op: 'checkout' }, null), { carhandling_checked_out_at: '2026-12-15T08:05:00.000Z' }, 'checkout')
})
