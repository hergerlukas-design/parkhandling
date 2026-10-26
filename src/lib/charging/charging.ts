import { berlinToIso } from '../../booking-adapters/parse'
import { formatMoney, formatTime, TIME_ZONE } from '../format'
import { supabase } from '../supabase'

/**
 * Laden erfassen (0.29.0): Ladepunkte mit eigenem QR-Aufkleber (PF-CHG:<Code>), Ladevorgänge je
 * Aufgabe „Laden“. Abruf der Werte über die Kempower-ChargEye-API (Edge Function charging-sync)
 * oder Eintrag von Hand. Regeln prüft die Datenbank (Migration 20261026000100_charging.sql).
 */

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export type ChargingProvider = 'manual' | 'kempower'
export type ChargingStatusCode = 'waiting' | 'charging' | 'ended' | 'failed' | 'manual'
export type BillingMode = 'flat' | 'per_kwh'

export interface ChargePoint {
  id: string
  code: string
  label: string | null
  location_id: string | null
  provider: ChargingProvider
  station_id: string | null
  connector_id: string | null
  qr_code: string
  legal_metering: boolean
  active: boolean
  sort_order: number
}

/** Zeile aus der View charging_session_board */
export interface ChargingSession {
  id: string
  booking_id: string
  task_id: string | null
  charge_point_id: string
  provider: ChargingProvider
  external_tx_id: string | null
  status: ChargingStatusCode
  source: 'api' | 'manual'
  linked_at: string
  started_at: string | null
  ended_at: string | null
  energy_kwh: number | null
  soc_start: number | null
  soc_end: number | null
  power_kw: number | null
  max_power_kw: number | null
  end_reason: string | null
  last_polled_at: string | null
  billing_mode: BillingMode | null
  price_per_kwh: number | null
  amount: number | null
  charge_point_code: string
  charge_point_label: string | null
  legal_metering: boolean
  plate: string
  task_status: string | null
  linked_by_name: string | null
}

export interface ChargingSettings {
  provider: ChargingProvider
  api_enabled: boolean
  api_base_url: string
  poll_interval_minutes: number
  link_window_minutes: number
  billing_mode: BillingMode
  price_per_kwh: number | null
  auto_complete_task: boolean
}

export const DEFAULT_CHARGING_SETTINGS: ChargingSettings = {
  provider: 'manual',
  api_enabled: false,
  api_base_url: 'https://kempower.io/api',
  poll_interval_minutes: 5,
  link_window_minutes: 15,
  billing_mode: 'flat',
  price_per_kwh: null,
  auto_complete_task: false,
}

export interface StationInfo {
  station_id: string
  name: string | null
  status: string | null
  connectors: { connector_id: string; status: string | null; charging: boolean }[]
}

export interface ChargingApiStatus {
  api_enabled: boolean
  refresh_token_in_vault: boolean
  last_sync_at: string | null
  last_success_at: string | null
  last_error: string | null
  test_requested_at: string | null
  stations: StationInfo[]
}

export const SESSION_STATUS: Record<ChargingStatusCode, { label: string; className: string }> = {
  waiting: { label: 'wartet auf Ladestart', className: 'bg-accent-soft text-accent-dark' },
  charging: { label: 'lädt', className: 'bg-ok-soft text-ok-ink' },
  ended: { label: 'beendet', className: 'bg-chip text-ink' },
  failed: { label: 'getrennt / nicht erkannt', className: 'bg-danger-soft text-danger-ink' },
  manual: { label: 'Werte eintragen', className: 'bg-accent-soft text-accent-dark' },
}

export const OPEN_STATUSES: ChargingStatusCode[] = ['waiting', 'charging', 'manual']

// ---------------------------------------------------------------------------------------------
// Reine Hilfsfunktionen (getestet in charging.test.ts)

export type ChargeScan =
  | { kind: 'charge_point'; code: string }
  | { kind: 'display' }
  | { kind: 'other'; text: string }

const DISPLAY_URL = /^https?:\/\/([a-z0-9-]+\.)*kempower\.(io|com)\/c\//i

/** QR-Inhalt deuten: PF-CHG:LP1 bzw. LP1 = Ladepunkt; kempower.io/c/… = Code vom Display der Säule */
export function parseChargeScan(raw: string): ChargeScan {
  const text = raw.trim()
  if (DISPLAY_URL.test(text)) return { kind: 'display' }
  const m = /^PF-CHG:([A-Z0-9][A-Z0-9-]{0,19})$/i.exec(text)
  if (m) return { kind: 'charge_point', code: m[1].toUpperCase() }
  if (/^LP[0-9A-Z-]{1,18}$/i.test(text)) return { kind: 'charge_point', code: text.toUpperCase() }
  return { kind: 'other', text }
}

export const DISPLAY_CODE_HINT = 'Das ist der Code vom Display der Ladesäule. Bitte den Aufkleber am Ladepunkt scannen.'

/** kWh-Eingabe mit Dezimalkomma, höchstens 3 Nachkommastellen, 0–500 */
export function parseKwh(input: string): number | null {
  const s = input.trim().replace(/\s/g, '')
  if (!/^\d{1,3}([.,]\d{1,3})?$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return n >= 0 && n <= 500 ? n : null
}

/** Ladestand-Eingabe 0–100 (leer = nicht angegeben) */
export function parseSoc(input: string): number | null | undefined {
  const s = input.trim()
  if (!s) return null
  if (!/^\d{1,3}$/.test(s)) return undefined
  const n = Number(s)
  return n <= 100 ? n : undefined
}

const kwh1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const kwh3 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 3 })

/** 23.4117 → "23,4 kWh" (präzise: "23,412 kWh") */
export function formatKwh(value: number | null | undefined, precise = false): string {
  if (value === null || value === undefined) return '– kWh'
  return `${(precise ? kwh3 : kwh1).format(Number(value))} kWh`
}

/** Dauer zwischen zwei Zeitpunkten, z. B. "1 h 05 min" */
export function durationLabel(start: string | null, end: string | null, now: Date = new Date()): string {
  if (!start) return '–'
  const ms = (end ? new Date(end) : now).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '–'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

/** Betrag pro kWh (kaufmännisch gerundet wie in der Datenbank) */
export function chargingAmount(kwh: number, pricePerKwh: number): number {
  return Math.round(kwh * pricePerKwh * 100 + Number.EPSILON) / 100
}

/** Darf diese Ladung pro kWh abgerechnet werden? Sonst Grund für den Hinweis. */
export function perKwhBilling(
  session: Pick<ChargingSession, 'status' | 'source' | 'energy_kwh' | 'legal_metering'>,
  settings: Pick<ChargingSettings, 'billing_mode' | 'price_per_kwh'>,
): { ok: true; amount: number; label: string } | { ok: false; reason: string } | null {
  if (settings.billing_mode !== 'per_kwh') return null
  if (session.status !== 'ended' || session.energy_kwh === null) return { ok: false, reason: 'Ladung noch nicht beendet' }
  if (!session.legal_metering || session.source !== 'api') {
    return { ok: false, reason: 'Abrechnung pro kWh nur mit eichrechtskonformer Messung' }
  }
  if (!settings.price_per_kwh || settings.price_per_kwh <= 0) return { ok: false, reason: 'Kein Preis pro kWh hinterlegt' }
  const amount = chargingAmount(Number(session.energy_kwh), settings.price_per_kwh)
  return { ok: true, amount, label: `${formatKwh(session.energy_kwh, true)} × ${formatMoney(settings.price_per_kwh)} = ${formatMoney(amount)}` }
}

const berlinDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * Uhrzeit „HH:MM“ am Berliner Kalendertag von `baseIso` → ISO. Liegt das Ergebnis vor `notBefore`,
 * gilt der Folgetag (Ladung über Mitternacht). Ungültige Eingabe → null.
 */
export function berlinTimeOnDay(baseIso: string, hhmm: string, notBefore?: string | null): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const [y, mo, d] = berlinDayFmt.format(new Date(baseIso)).split('-').map(Number)
  let iso = berlinToIso(y, mo, d, Number(m[1]), Number(m[2]))
  if (iso && notBefore && iso < new Date(notBefore).toISOString()) {
    const next = new Date(Date.UTC(y, mo - 1, d + 1))
    iso = berlinToIso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), Number(m[1]), Number(m[2]))
  }
  return iso
}

/** ISO → „HH:MM“ (Berlin) für Zeitfelder */
export function timeInputValue(iso: string): string {
  return formatTime(iso)
}

export function sumKwh(sessions: Pick<ChargingSession, 'status' | 'energy_kwh'>[]): number {
  return sessions.filter((s) => s.status === 'ended').reduce((sum, s) => sum + Number(s.energy_kwh ?? 0), 0)
}

// ---------------------------------------------------------------------------------------------
// Datenbank

export async function listTaskSessions(taskId: string): Promise<ChargingSession[]> {
  const { data, error } = await db()
    .from('charging_session_board')
    .select('*')
    .eq('task_id', taskId)
    .order('linked_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ChargingSession[]
}

export async function listBookingSessions(bookingId: string): Promise<ChargingSession[]> {
  const { data, error } = await db()
    .from('charging_session_board')
    .select('*')
    .eq('booking_id', bookingId)
    .order('linked_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ChargingSession[]
}

/** Offene Ladung an einem Ladepunkt (zentraler Scan) */
export async function openSessionAt(code: string): Promise<ChargingSession | null> {
  const { data, error } = await db()
    .from('charging_session_board')
    .select('*')
    .eq('charge_point_code', code)
    .in('status', OPEN_STATUSES)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ChargingSession | null) ?? null
}

export interface StartResult {
  session_id: string
  status: ChargingStatusCode
  charge_point_code: string
  location_hint: { code: string; name: string | null } | null
}

export async function startCharging(taskId: string, code: string): Promise<StartResult> {
  const { data, error } = await db().rpc('start_charging', { p_task_id: taskId, p_code: code })
  if (error) throw new Error(error.message)
  return data as StartResult
}

export async function saveManualCharging(
  sessionId: string,
  values: { energyKwh: number; startedAt?: string | null; endedAt?: string | null; socStart?: number | null; socEnd?: number | null },
): Promise<void> {
  const { error } = await db().rpc('save_manual_charging', {
    p_session_id: sessionId,
    p_energy_kwh: values.energyKwh,
    p_started_at: values.startedAt ?? null,
    p_ended_at: values.endedAt ?? null,
    p_soc_start: values.socStart ?? null,
    p_soc_end: values.socEnd ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function cancelCharging(sessionId: string, reason?: string): Promise<void> {
  const { error } = await db().rpc('cancel_charging', { p_session_id: sessionId, p_reason: reason ?? null })
  if (error) throw new Error(error.message)
}

export async function applyChargingPrice(sessionId: string): Promise<number> {
  const { data, error } = await db().rpc('apply_charging_price', { p_session_id: sessionId })
  if (error) throw new Error(error.message)
  return Number(data)
}

export async function loadChargingSettings(): Promise<ChargingSettings> {
  const { data, error } = await db().from('settings').select('value').eq('key', 'charging').maybeSingle()
  if (error) throw new Error('Einstellungen konnten nicht geladen werden')
  return { ...DEFAULT_CHARGING_SETTINGS, ...((data?.value as Partial<ChargingSettings> | undefined) ?? {}) }
}

export async function saveChargingSettings(settings: ChargingSettings): Promise<void> {
  const { error } = await db().from('settings').update({ value: settings }).eq('key', 'charging')
  if (error) throw new Error('Einstellungen konnten nicht gespeichert werden')
}

export async function listChargePoints(): Promise<ChargePoint[]> {
  const { data, error } = await db().from('charge_points').select('*').order('sort_order').order('code')
  if (error) throw new Error(error.message)
  return (data ?? []) as ChargePoint[]
}

export type ChargePointInput = Pick<
  ChargePoint,
  'code' | 'label' | 'location_id' | 'provider' | 'station_id' | 'connector_id' | 'legal_metering' | 'active'
>

export async function saveChargePoint(id: string | null, input: ChargePointInput): Promise<void> {
  const code = input.code.trim().toUpperCase()
  const row = {
    code,
    location_id: input.location_id,
    provider: input.provider,
    legal_metering: input.legal_metering,
    active: input.active,
    label: input.label?.trim() || null,
    station_id: input.station_id?.trim() || null,
    connector_id: input.connector_id?.trim() || null,
  }
  const { error } = id
    ? await db().from('charge_points').update(row).eq('id', id)
    : await db().from('charge_points').insert({ ...row, qr_code: `PF-CHG:${code}` })
  if (error) {
    if (error.code === '23505') throw new Error(`Ladepunkt ${code} gibt es schon`)
    if (error.code === '23514') throw new Error('Code: nur Großbuchstaben, Ziffern und Bindestrich, z. B. LP3')
    throw new Error(error.message)
  }
}

export async function loadChargingStatus(): Promise<ChargingApiStatus> {
  const { data, error } = await db().rpc('charging_status')
  if (error) throw new Error(error.message)
  return data as ChargingApiStatus
}

export async function requestChargingTest(): Promise<boolean> {
  const { data, error } = await db().rpc('request_charging_test')
  if (error) throw new Error(error.message)
  return !!data
}
