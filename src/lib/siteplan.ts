import type { BookingStatus, FuelType, LocationArea, LocationStatus, ReturnMode } from '../types/domain'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

/** Ein Ort mit aktueller Belegung (View location_board). */
export interface BoardSlot {
  id: string
  code: string
  name: string | null
  area: LocationArea
  rack: number | null
  rack_column: number | null
  level: 1 | 2 | 3 | null
  row: string | null
  number: number | null
  has_cover: boolean
  capacity: number
  status: LocationStatus
  qr_code: string | null
  sort_order: number
  occupancy: number
  booking_id: string | null
  plate: string | null
  vehicle_model: string | null
  end_at: string | null
  booking_status: BookingStatus | null
  return_mode: ReturnMode | null
  fuel_type: FuelType | null
  open_task_count: number
}

export async function loadBoard(): Promise<BoardSlot[]> {
  const { data, error } = await db().from('location_board').select('*').order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as BoardSlot[]
}

/** Lageplan bei Änderungen an Stellplätzen live aktualisieren (Realtime nur auf locations). */
export function subscribeBoard(onChange: () => void): () => void {
  if (!supabase) return () => undefined
  const channel = supabase
    .channel('lageplan')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, () => onChange())
    .subscribe()
  return () => void supabase?.removeChannel(channel)
}

export interface Suggestion {
  location_id: string
  code: string
  kind: 'fits' | 'conflict' | 'relocate' | 'buffer'
  reason: string
  moves: number
  score: number
}

export async function suggestHallLocation(bookingId: string): Promise<Suggestion[]> {
  const { data, error } = await db().rpc('suggest_hall_location', { p_booking_id: bookingId })
  if (error) throw new Error(error.message)
  return (data ?? []) as Suggestion[]
}

type ParkingType = CheckinCandidate['parking_type']

/** Hallenvorschläge kürzen: bis zu 3 passende, 3 weitere, dann Puffer */
export function rankHallSuggestions(list: Suggestion[]): Suggestion[] {
  const fits = list.filter((s) => s.kind === 'fits').slice(0, 3)
  const rest = list.filter((s) => s.kind !== 'fits' && s.kind !== 'buffer').slice(0, 3)
  const buffer = list.filter((s) => s.kind === 'buffer')
  return [...fits, ...rest, ...buffer]
}

/** Außen: erste freie Plätze im passenden Bereich (mit Plane → A, ohne → B), dazu ein Pufferplatz */
export function outdoorSuggestions(board: BoardSlot[], parkingType: ParkingType): Suggestion[] {
  const area = parkingType === 'outdoor_cover' ? 'outdoor_a' : 'outdoor_b'
  const free = board.filter((s) => s.status === 'free' && !s.booking_id)
  const inArea = free.filter((s) => s.area === area).slice(0, 4)
  const buffer = free.filter((s) => s.area === 'buffer').slice(0, 1)
  return [
    ...inArea.map((s, i) => ({
      location_id: s.id, code: s.code, kind: 'fits' as const, moves: 0, score: i,
      reason: area === 'outdoor_a' ? 'Freier Platz mit Abdeckplane.' : 'Freier Außenplatz.',
    })),
    ...buffer.map((s) => ({
      location_id: s.id, code: s.code, kind: 'buffer' as const, moves: 0, score: 9999,
      reason: 'Pufferzone: kurzfristig abstellen und später einlagern.',
    })),
  ]
}

/** Platzvorschläge für eine Buchung: Halle über Regal-Logik, Außen erster freier Platz */
export async function suggestLocations(b: { id: string; parking_type: ParkingType }): Promise<Suggestion[]> {
  if (b.parking_type === 'indoor') return rankHallSuggestions(await suggestHallLocation(b.id))
  return outdoorSuggestions(await loadBoard(), b.parking_type)
}

/** Empfohlener Platz: erster passender, sonst Puffer */
export function recommendedSuggestion(list: Suggestion[]): Suggestion | null {
  return list.find((s) => s.kind === 'fits') ?? list.find((s) => s.kind === 'buffer') ?? null
}

export interface MoveResult {
  from: string | null
  to: string | null
  status: BookingStatus
  warnings: string[]
}

/** Ein-/Auschecken, Umsetzen, Übergabe (toCode = null). Regeln prüft die Datenbank. */
export async function moveVehicle(
  bookingId: string,
  toCode: string | null,
  reason?: string,
): Promise<MoveResult> {
  // Schlüsselfach = Stellplatz, die App erfasst keine Schlüssel (p_key_code entfällt)
  const { data, error } = await db().rpc('move_vehicle', {
    p_booking_id: bookingId,
    p_to_code: toCode,
    p_reason: reason ?? null,
  })
  if (error) throw new Error(error.message)
  return data as MoveResult
}

export interface CheckinCandidate {
  id: string
  plate: string
  vehicle_model: string | null
  customer_name: string
  external_ref: string | null
  start_at: string
  end_at: string
  parking_type: 'indoor' | 'outdoor_cover' | 'outdoor'
  status: BookingStatus
  open_task_count: number
  task_chips: { title: string | null; status: string }[]
}

/** Buchungen, die eingecheckt werden können (gebucht/angekommen, noch ohne Stellplatz). */
export async function listCheckinCandidates(search = ''): Promise<CheckinCandidate[]> {
  let q = db()
    .from('booking_list')
    .select('id, plate, vehicle_model, customer_name, external_ref, start_at, end_at, parking_type, status, open_task_count, task_chips')
    .in('status', ['booked', 'arrived', 'in_transit'])
    .order('start_at')
    .limit(30)
  const text = search.trim()
  if (text) {
    const plate = text.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '')
    q = q.or(`plate_normalized.like.${plate}%,customer_name.ilike.%${text.replace(/[%,()"]/g, ' ')}%,external_ref.ilike.${text.replace(/[%,()"]/g, ' ')}%`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as CheckinCandidate[]
}

export async function getCheckinCandidate(id: string): Promise<CheckinCandidate | null> {
  const { data, error } = await db()
    .from('booking_list')
    .select('id, plate, vehicle_model, customer_name, external_ref, start_at, end_at, parking_type, status, open_task_count, task_chips')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as CheckinCandidate | null
}

export interface ScanTarget {
  kind: 'key' | 'location' | 'unknown'
  code: string
}

/**
 * Schlüsselfächer (Issue #16): Jeder Stellplatz in Halle und Außenfläche hat genau ein Schlüsselfach,
 * Fach-Code = Stellplatz-Code (z. B. R1-E1). Die App erfasst keine Schlüssel; der Schlüssel liegt im
 * Fach des Platzes, auf dem das Fahrzeug steht. In Aufbereitung, Puffer oder unterwegs geht er mit.
 */
const KEY_SLOT_CODE = /^(R\d+-E[1-3]|[AB]\d-\d{2})$/

/** Hat dieser Platz ein Schlüsselfach (Halle, Außen A/B)? */
export function hasKeySlot(code: string | null | undefined): code is string {
  return !!code && KEY_SLOT_CODE.test(code)
}

/** Was nach einer Bewegung mit dem Schlüssel zu tun ist (null = nichts) */
export function keyHint(from: string | null, to: string | null): string | null {
  const fromSlot = hasKeySlot(from) ? from : null
  const toSlot = hasKeySlot(to) ? to : null
  if (fromSlot === toSlot) return null
  if (fromSlot && toSlot) return `Schlüssel mitnehmen: Fach ${fromSlot} → Fach ${toSlot}.`
  if (toSlot) return `Schlüssel ins Fach ${toSlot} legen.`
  if (to === null) return `Schlüssel aus Fach ${fromSlot} nehmen und mit dem Fahrzeug übergeben.`
  return `Schlüssel aus Fach ${fromSlot} nehmen, er geht mit dem Fahrzeug.`
}

/** Wo Fahrzeug und Schlüssel gerade sind, für Listen und Suche */
export function whereabouts(code: string | null | undefined): string {
  if (!code) return 'nicht eingecheckt'
  if (KEY_SLOT_CODE.test(code)) return `Fach ${code}`
  if (code.startsWith('W-AUF')) return 'in Aufbereitung'
  if (code.startsWith('W-LAD')) return 'am Ladeplatz'
  if (code === 'W-UEB') return 'in der Übergabezone'
  if (code.startsWith('P-')) return 'im Puffer'
  if (code.startsWith('T-')) return 'unterwegs (Hol- & Bringservice)'
  return code
}

/** QR-Inhalt deuten: PF-LOC:R3-E1, ein reiner Stellplatz-Code oder PF-KEY:R3-E1 (Anhänger aus 0.17.0). */
export function parseScan(raw: string): ScanTarget {
  const text = raw.trim().toUpperCase()
  const key = /^PF-KEY:([A-Z0-9-]+)$/.exec(text)
  if (key && hasKeySlot(key[1])) return { kind: 'key', code: key[1] }
  const loc = /^PF-LOC:([A-Z0-9-]+)$/.exec(text)
  if (loc) return { kind: 'location', code: loc[1] }
  if (/^(R\d+-E[1-3]|[AB]\d-\d{2}|W-[A-Z0-9]+|P-\d{2}|T-[A-Z]+)$/.test(text)) return { kind: 'location', code: text }
  return { kind: 'unknown', code: raw.trim() }
}

/** Fahrzeug auf einem Stellplatz (null = Platz unbekannt) */
export async function findBookingAt(code: string): Promise<{ booking_id: string | null } | null> {
  const { data, error } = await db().from('location_board').select('booking_id').eq('code', code).maybeSingle()
  if (error) throw new Error(error.message)
  return data as { booking_id: string | null } | null
}

/** Ziele beim Auschecken/Umsetzen (Abschnitt 8) */
export const MOVE_TARGETS: { code: string | null; label: string; reason: string }[] = [
  { code: 'W-UEB', label: 'Übergabezone', reason: 'Übergabe vorbereiten' },
  { code: 'T-VAL', label: 'Hol- & Bringservice unterwegs', reason: 'Hol- & Bringservice' },
  { code: null, label: 'Übergeben (verlässt das Gelände)', reason: 'Übergeben' },
]
