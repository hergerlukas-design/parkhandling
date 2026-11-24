// Reine Logik der Buchungs-Synchronisation (ohne Deno-/Supabase-Abhängigkeiten, damit testbar).
//
// Das neue Buchungsbackend (Supabase-Projekt der Organisation CarHandling, Stripe) schickt jede neue
// oder geänderte Buchung per Database Webhook an die Edge Function booking-sync. Das Format seiner
// Tabelle ist noch nicht verbindlich bekannt; die Zuordnung ist deshalb bewusst tolerant:
//  * Zeilen im Format unserer Tabelle bookings (customer_name, start_at, end_at, …) und
//  * Zeilen im Format des Rechner-Formulars (first_name, arrival_date, arrival_time, flights, amount, …)
// werden beide verstanden. Fehlt eine Pflichtangabe, wird nichts angelegt; der Fehler landet in der
// Prüfliste der App (booking_imports, channel 'webhook').

import { berlinToUtcIso } from '../_shared/berlin-time.ts'

export const SYNC_SOURCE = 'carhandling'
export const TICKET_BASE = 'https://parkhandling-rechner.pplx.app/ticket.html#'

type Rec = Record<string, unknown>
export type SyncEvent = 'new' | 'change' | 'cancel'

/** Eingabe für public.sync_external_booking */
export interface SyncInput {
  source: string
  external_ref: string | null
  event: SyncEvent
  /** Felder für public.upsert_booking (nur vorhandene Angaben) */
  booking: Rec
  tariff_code: string | null
  /** Originaldatensatz für das Protokoll */
  raw: Rec
  error: string | null
  /** Noch nicht bezahlt/bestätigt (z. B. Stripe-Checkout offen): nur übernehmen, wenn schon vorhanden */
  pending: boolean
  /** E-Auto laden gebucht → Leistung LADEN (Pauschale im Betrag) */
  charging: boolean
  charging_target: string | null
}

/**
 * Hülle eines Supabase Database Webhooks: { type: INSERT|UPDATE|DELETE, table, schema, record, old_record }.
 * Alternativ direkt { booking: {...} } oder { record: {...} } (z. B. Aufruf aus eigenem Code).
 */
export function unwrapPayload(body: unknown): { record: Rec; deleted: boolean } | { error: string } {
  if (!isRec(body)) return { error: 'JSON-Objekt erwartet' }
  const type = String(body.type ?? '').toUpperCase()
  if (type === 'DELETE') {
    if (isRec(body.old_record)) return { record: body.old_record, deleted: true }
    return { error: 'DELETE ohne old_record' }
  }
  if (isRec(body.record)) return { record: body.record, deleted: false }
  if (isRec(body.booking)) return { record: body.booking, deleted: false }
  return { error: 'Kein Datensatz (record oder booking) gefunden' }
}

const TARIFF_ALIASES: Record<string, string> = {
  economy: 'economy',
  space: 'space',
  carcover: 'space',
  car_cover: 'space',
  cover: 'space',
  business: 'business',
  premium: 'premium',
}

const PARKING_TYPES = ['indoor', 'outdoor_cover', 'outdoor']
const FUEL_TYPES = ['combustion', 'electric', 'hybrid']
const PAYMENT_STATUSES = ['open', 'partial', 'paid', 'refunded']
const CANCELLED = ['cancelled', 'canceled', 'storniert', 'refunded_cancelled', 'expired', 'abandoned', 'failed', 'payment_failed']
/** Status, solange die Zahlung noch aussteht (ohne paid_at) */
const PENDING = ['pending', 'awaiting_payment', 'payment_pending', 'checkout', 'draft', 'created', 'unpaid', 'open', 'new', 'requires_payment_method']
const FUEL_ALIASES: Record<string, string> = {
  combustion: 'combustion', verbrenner: 'combustion', benzin: 'combustion', diesel: 'combustion', petrol: 'combustion',
  gasoline: 'combustion', 'benzin/diesel': 'combustion', electric: 'electric', elektro: 'electric', ev: 'electric',
  bev: 'electric', e_auto: 'electric', hybrid: 'hybrid', plugin_hybrid: 'hybrid', plug_in_hybrid: 'hybrid', phev: 'hybrid',
}
/** Felder, die nicht ins Protokoll gehören (Kennungen anderer Systeme, kein Nutzen im Dashboard) */
const RAW_DROP = ['fingerprint', 'stripe_session_id', 'stripe_payment_intent', 'checkin_token', 'ticket_token', 'confirmation_error']

/** Originaldatensatz fürs Protokoll, ohne Fremdkennungen */
export function redactRaw(record: Rec): Rec {
  const out: Rec = {}
  for (const [k, v] of Object.entries(record)) if (!RAW_DROP.includes(k)) out[k] = v
  return out
}

/** Datensatz des neuen Backends → Eingabe für sync_external_booking */
export function mapRecord(record: Rec, deleted: boolean): SyncInput {
  const ref = str(pick(record, 'booking_ref', 'booking_number', 'buchungsnummer', 'external_ref', 'reference', 'ref', 'id'))
  const cancelled = deleted || CANCELLED.includes(lower(pick(record, 'status', 'booking_status'))) || !!pick(record, 'cancelled_at', 'canceled_at')
  const base: SyncInput = {
    source: SYNC_SOURCE,
    external_ref: ref,
    event: cancelled ? 'cancel' : 'new',
    booking: {},
    tariff_code: null,
    raw: redactRaw(record),
    error: null,
    pending: false,
    charging: false,
    charging_target: null,
  }
  if (!ref) return { ...base, error: 'Buchungsnummer fehlt (booking_ref, external_ref oder id)' }
  // Storno: nur die Kennung zählt, alles andere bleibt, wie es ist
  if (cancelled) return { ...base, booking: { external_ref: ref, cancelled: true } }

  const b: Rec = { external_ref: ref }
  const missing: string[] = []

  const name = str(pick(record, 'customer_name', 'name')) ??
    join(pick(record, 'first_name', 'firstname', 'vorname'), pick(record, 'last_name', 'lastname', 'nachname'))
  if (name) b.customer_name = name
  else missing.push('Name')

  const plate = str(pick(record, 'plate', 'license_plate', 'kennzeichen'))
  if (plate) b.plate = plate.toUpperCase()
  else missing.push('Kennzeichen')

  const start = timestamp(record, ['start_at', 'arrival_at'], ['arrival_date', 'anreise_datum'], ['arrival_time', 'anreise_zeit'])
  const end = timestamp(record, ['end_at', 'pickup_at', 'return_at'], ['pickup_date', 'abholung_datum'], ['pickup_time', 'abholung_zeit'])
  if (start) b.start_at = start
  else missing.push('Anreise')
  if (end) b.end_at = end
  else missing.push('Abholung')

  const tariff = TARIFF_ALIASES[lower(pick(record, 'tariff_code', 'tariff', 'tarif')).replace(/[\s-]/g, '_')] ?? null
  const parking = lower(pick(record, 'parking_type'))
  if (PARKING_TYPES.includes(parking)) b.parking_type = parking
  else if (!tariff) missing.push('Tarif oder Stellplatzart')

  if (missing.length > 0) return { ...base, error: `Pflichtangaben fehlen: ${missing.join(', ')}` }

  setIf(b, 'customer_email', str(pick(record, 'customer_email', 'email'))?.toLowerCase())
  setIf(b, 'customer_phone', str(pick(record, 'customer_phone', 'phone', 'telefon')))
  setIf(b, 'company', str(pick(record, 'company', 'firma')))
  setIf(b, 'vehicle_model', str(pick(record, 'vehicle_model', 'vehicle', 'fahrzeug')))
  const fuel = FUEL_ALIASES[lower(pick(record, 'fuel_type', 'antrieb')).replace(/[\s-]+/g, '_')] ?? null
  if (fuel && FUEL_TYPES.includes(fuel)) b.fuel_type = fuel

  const persons = int(pick(record, 'persons', 'passengers', 'personen'))
  if (persons !== null && persons >= 0 && persons <= 50) b.persons = persons

  const ret = returnMode(pick(record, 'return_mode', 'rueckgabe'))
  if (ret) b.return_mode = ret

  const [out, back] = flights(record)
  setIf(b, 'flight_out', out)
  setIf(b, 'flight_return', back)

  const lang = lower(pick(record, 'customer_language', 'language', 'sprache'))
  if (lang === 'de' || lang === 'en') b.customer_language = lang

  const price = num(pick(record, 'price_total', 'amount', 'total', 'betrag'))
  if (price !== null && price >= 0) b.price_total = price

  const pay = paymentStatus(record)
  if (pay) b.payment_status = pay

  const created = str(pick(record, 'created_at', 'received_at'))
  if (created && !Number.isNaN(Date.parse(created))) b.received_at = new Date(created).toISOString()

  b.notes = notes(record)

  const charging = bool(pick(record, 'charging', 'laden', 'ev_charging'))
  const target = pick(record, 'charging_target', 'ladeziel')
  const chargingTarget = typeof target === 'number' ? `${target} %` : str(target)
  // Ohne Zahlung und mit einem „offen“-Status: abgebrochener oder laufender Checkout
  const pending = pay !== 'paid' && PENDING.includes(lower(pick(record, 'status', 'booking_status')))

  return {
    ...base,
    event: 'change',
    booking: b,
    tariff_code: tariff,
    pending,
    charging,
    charging_target: charging ? chargingTarget : null,
  }
}

function notes(r: Rec): string {
  const lines: string[] = []
  const own = str(pick(r, 'notes', 'note', 'wuensche', 'message'))
  if (own) lines.push(own)
  const seats = int(pick(r, 'child_seats', 'kindersitze'))
  const luggage = int(pick(r, 'luggage', 'gepaeck'))
  if (seats !== null || luggage !== null) lines.push(`Kindersitze: ${seats ?? 0} · Gepäckstücke: ${luggage ?? 0}`)
  const token = str(pick(r, 'checkin_token', 'ticket_token'))
  if (token && /^[0-9a-f]{32}$/i.test(token)) lines.push(`Check-in-Ticket: ${TICKET_BASE}${token}`)
  lines.push('Übernommen aus dem CarHandling-Buchungsbackend')
  return lines.join('\n')
}

function paymentStatus(r: Rec): string | null {
  const raw = lower(pick(r, 'payment_status', 'stripe_payment_status', 'zahlung'))
  if (PAYMENT_STATUSES.includes(raw)) return raw
  if (['succeeded', 'complete', 'completed', 'bezahlt'].includes(raw)) return 'paid'
  if (['unpaid', 'pending', 'requires_payment_method', 'offen'].includes(raw)) return 'open'
  if (r.paid === true || !!str(pick(r, 'paid_at'))) return 'paid'
  return null
}

function returnMode(v: unknown): string | null {
  const s = lower(v)
  if (!s) return null
  if (s === 'shuttle') return 'shuttle'
  if (s === 'self' || s === 'selbst') return 'self'
  if (['pickup_delivery', 'valet', 'vallet', 'hol- und bringservice', 'hol_bring'].includes(s)) return 'pickup_delivery'
  return null
}

/** Flugnummern: getrennte Felder oder ein gemeinsames Feld „LH 2020 / LH 2021“ */
export function flights(r: Rec): [string | null, string | null] {
  const out = flightNo(pick(r, 'flight_out', 'flight_outbound', 'flight_hin'))
  const back = flightNo(pick(r, 'flight_return', 'flight_back', 'flight_rueck'))
  if (out || back) return [out, back]
  const both = str(pick(r, 'flights', 'flugnummern'))
  if (!both) return [null, null]
  const parts = both.split(/[/,;|]+/).map((p) => flightNo(p)).filter(Boolean) as string[]
  return [parts[0] ?? null, parts[1] ?? null]
}

function flightNo(v: unknown): string | null {
  const s = (str(v) ?? '').toUpperCase().replace(/\s+/g, '')
  return s || null
}

/** Zeitpunkt aus einem ISO-Feld oder aus Datum (YYYY-MM-DD oder TT.MM.JJJJ) + Uhrzeit in Berliner Zeit */
export function timestamp(r: Rec, isoKeys: string[], dateKeys: string[], timeKeys: string[]): string | null {
  const iso = str(pick(r, ...isoKeys))
  if (iso && /^\d{4}-\d{2}-\d{2}T/.test(iso) && !Number.isNaN(Date.parse(iso))) {
    // Ohne Zeitzone gilt Berliner Zeit
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return berlinToUtcIso(iso.slice(0, 10), iso.slice(11, 16))
    return new Date(iso).toISOString()
  }
  const date = isoDate(str(pick(r, ...dateKeys)))
  const time = clock(str(pick(r, ...timeKeys)))
  if (!date || !time) return null
  return berlinToUtcIso(date, time)
}

function isoDate(v: string | null): string | null {
  if (!v) return null
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

function clock(v: string | null): string | null {
  const m = (v ?? '').match(/^(\d{1,2}):(\d{2})/)
  if (!m || +m[1] > 23 || +m[2] > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function pick(r: Rec, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = r[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function str(v: unknown): string | null {
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

function lower(v: unknown): string {
  return (str(v) ?? '').toLowerCase()
}

function join(a: unknown, b: unknown): string | null {
  return [str(a), str(b)].filter(Boolean).join(' ') || null
}

function bool(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'number') return v === 1
  return /^(true|1|ja|yes)$/i.test(str(v) ?? '')
}

function int(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.trunc(n)
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = str(v)
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function setIf(target: Rec, key: string, value: unknown) {
  if (value !== null && value !== undefined && value !== '') target[key] = value
}

/** Zeitkonstanter Vergleich des Webhook-Geheimnisses */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 24) return false
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}
