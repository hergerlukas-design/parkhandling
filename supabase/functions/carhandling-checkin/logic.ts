// Annahme und Rückgabe im Dashboard an CarHandling melden (Edge Function checkin-status bei CarHandling).
// Reine Logik ohne Deno-/Supabase-Abhängigkeiten, damit testbar.
//
// Annahme = Annahmeprotokoll abgeschlossen → op 'checkin'
// Rückgabe = Übergabeprotokoll abgeschlossen → op 'checkout'
// Gemeldet wird nur, was CarHandling noch nicht hat (carhandling_checked_in_at/_out_at, per Webhook gepflegt).

export type CheckinOp = 'checkin' | 'checkout'

export interface CheckinBooking {
  id: string
  external_ref: string | null
  status: string
  carhandling_checked_in_at: string | null
  carhandling_checked_out_at: string | null
  protocols: { type: string; status: string; finalized_at: string | null }[] | null
}

export interface CheckinRequest {
  booking_ref: string
  op: CheckinOp
  at: string
}

/** Meldungen, die für diese Buchung noch ausstehen (Reihenfolge: erst Annahme, dann Rückgabe) */
export function pendingRequests(b: CheckinBooking): CheckinRequest[] {
  if (!b.external_ref || b.status === 'cancelled') return []
  const final = (type: string) => (b.protocols ?? []).find((p) => p.type === type && p.status === 'final')
  const intake = final('intake')
  const handover = final('handover')
  const out: CheckinRequest[] = []
  if (intake && !b.carhandling_checked_in_at) {
    out.push({ booking_ref: b.external_ref, op: 'checkin', at: intake.finalized_at ?? new Date().toISOString() })
  }
  if (handover && !b.carhandling_checked_out_at) {
    out.push({ booking_ref: b.external_ref, op: 'checkout', at: handover.finalized_at ?? new Date().toISOString() })
  }
  return out
}

/** Antwort von CarHandling → Felder für unsere Buchung (nur gültige Zeitpunkte) */
export function stateFromResponse(req: CheckinRequest, data: unknown): Record<string, string> {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const pickIso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)
  const at = new Date(req.at).toISOString()
  return req.op === 'checkin'
    ? { carhandling_checked_in_at: pickIso(d.checked_in_at) ?? at }
    : { carhandling_checked_out_at: pickIso(d.checked_out_at) ?? at }
}
