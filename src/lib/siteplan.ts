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
  keyCode?: string | null,
): Promise<MoveResult> {
  const { data, error } = await db().rpc('move_vehicle', {
    p_booking_id: bookingId,
    p_to_code: toCode,
    p_reason: reason ?? null,
    p_key_code: keyCode ?? null,
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

export async function listFreeKeys(limit = 5): Promise<string[]> {
  const { data, error } = await db().from('keys').select('key_code').is('booking_id', null).order('key_code').limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((k) => k.key_code as string)
}

export interface ScanTarget {
  kind: 'key' | 'location' | 'unknown'
  code: string
}

/** QR-Inhalt deuten: PF-KEY:K-018, PF-LOC:R3-E1 oder ein reiner Code. */
export function parseScan(raw: string): ScanTarget {
  const text = raw.trim().toUpperCase()
  const key = /^PF-KEY:(K-\d{3})$/.exec(text) ?? /^(K-\d{3})$/.exec(text)
  if (key) return { kind: 'key', code: key[1] }
  const loc = /^PF-LOC:([A-Z0-9-]+)$/.exec(text)
  if (loc) return { kind: 'location', code: loc[1] }
  if (/^(R\d+-E[1-3]|[AB]\d-\d{2}|W-[A-Z0-9]+|P-\d{2}|T-[A-Z]+)$/.test(text)) return { kind: 'location', code: text }
  return { kind: 'unknown', code: raw.trim() }
}

export async function findBookingByKey(keyCode: string): Promise<{ booking_id: string | null } | null> {
  const { data, error } = await db().from('keys').select('booking_id').eq('key_code', keyCode).maybeSingle()
  if (error) throw new Error(error.message)
  return data as { booking_id: string | null } | null
}

/** Ziele beim Auschecken/Umsetzen (Abschnitt 8) */
export const MOVE_TARGETS: { code: string | null; label: string; reason: string }[] = [
  { code: 'W-AUF1', label: 'Aufbereitung 1', reason: 'Aufbereitung' },
  { code: 'W-AUF2', label: 'Aufbereitung 2', reason: 'Aufbereitung' },
  { code: 'W-LAD1', label: 'Ladeplatz 1', reason: 'Laden' },
  { code: 'W-LAD2', label: 'Ladeplatz 2', reason: 'Laden' },
  { code: 'W-UEB', label: 'Übergabezone', reason: 'Übergabe vorbereiten' },
  { code: 'T-VAL', label: 'Hol- & Bringservice unterwegs', reason: 'Hol- & Bringservice' },
  { code: null, label: 'Übergeben (verlässt das Gelände)', reason: 'Übergeben' },
]
