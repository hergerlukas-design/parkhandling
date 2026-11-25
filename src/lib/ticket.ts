// Kunden-QR-Code des Rechners (Check-in-Ticket bei CarHandling) im Dashboard:
// gescannten Code einer Buchung zuordnen, Ziel für Annahme bzw. Rückgabe bestimmen und
// Annahme/Rückgabe an CarHandling melden (Edge Function carhandling-checkin).
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export interface ScannedBooking {
  id: string
  status: string
  plate: string
  external_ref: string | null
  has_location: boolean
  intake_final: boolean
  handover_final: boolean
}

/** Buchung zu Ticket-Link, Ticket-Code oder Buchungsnummer (null = keine passende Buchung) */
export async function findBookingByScan(code: string): Promise<ScannedBooking | null> {
  const { data, error } = await db().rpc('find_booking_by_scan', { p_code: code })
  if (error) throw new Error(error.message)
  return (data as ScannedBooking | null) ?? null
}

export type TicketStep = { path: string } | { error: string; path?: string }

const NOT_PARKED = ['booked', 'arrived', 'in_transit']

/**
 * Wohin nach dem Scan?
 *  Annahme:  Annahmeprotokoll offen → Protokoll; danach ohne Stellplatz → Einchecken; sonst Fahrzeug
 *  Rückgabe: Übergabeprotokoll, solange die Buchung nicht abgeschlossen ist; sonst Fahrzeug
 */
export function ticketStep(b: ScannedBooking, mode: 'intake' | 'handover'): TicketStep {
  const vehicle = `/fahrzeuge/${b.id}`
  if (b.status === 'cancelled') return { error: `Buchung ${b.external_ref ?? b.plate} ist storniert.`, path: vehicle }
  if (mode === 'handover') {
    if (b.handover_final || b.status === 'completed') return { path: vehicle }
    if (!b.intake_final && !b.has_location) return { error: `${b.plate} ist noch nicht angenommen.`, path: vehicle }
    return { path: `/protokoll/uebergabe/${b.id}` }
  }
  if (b.status === 'completed') return { error: `${b.plate} ist bereits zurückgegeben.`, path: vehicle }
  if (!b.intake_final && !b.has_location) return { path: `/protokoll/annahme/${b.id}` }
  if (!b.has_location && NOT_PARKED.includes(b.status)) return { path: `/einchecken?booking=${b.id}` }
  return { path: vehicle }
}

/**
 * Annahme/Rückgabe an CarHandling melden. Wirkt nur bei Rechner-Buchungen; ohne Netz oder wenn
 * CarHandling nicht antwortet, holt reportPendingCheckinsOnce die Meldung später nach.
 */
export async function reportCheckin(bookingId: string): Promise<void> {
  await db().functions.invoke('carhandling-checkin', { body: { booking_id: bookingId } }).catch(() => undefined)
}

let pendingReported = false

/** Ausstehende Meldungen einmal je Sitzung nachholen */
export async function reportPendingCheckinsOnce(): Promise<void> {
  if (pendingReported) return
  pendingReported = true
  await db().functions.invoke('carhandling-checkin', { body: { pending: true } }).catch(() => undefined)
}
