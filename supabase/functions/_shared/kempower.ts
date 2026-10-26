// Kempower ChargEye REST-API: Normalisierung und Abruf-Logik für die Edge Function charging-sync.
// Ohne Deno-Globals, damit Vitest die Logik direkt testen kann (src/lib/charging/kempower.test.ts).
//
// Dokumentation: https://docs.kempower.io (OpenAPI je API herunterladbar).
//  * Auth: GET {base}/auth/refreshAccessToken mit Bearer <Refresh-Token> → { token, validUntil } (8 h gültig)
//  * GET {base}/stations                                 → Stationen mit Connectoren und Transaktion
//  * GET {base}/transactions/{txId}                      → eine Transaktion
//  * GET {base}/chargingStations/{stationId}/transactions → Transaktionen einer Station (filterStartTime)
//
// Die Feldnamen sind laut Dokumentation u. a. txId, stationId, evseId, status, startTime, endTime,
// chargedEnergyKwh, socStart, soc, powerKw, chargingEndReason. Die Normalisierung akzeptiert bewusst
// auch naheliegende Varianten, bis eine echte Antwort vorliegt. Vor dem Produktivbetrieb mit der
// OpenAPI-Spezifikation bzw. „Verbindung testen“ abgleichen.

export type TxState = 'charging' | 'ended'

/** Normalisierte Transaktion – so geht sie an charging_apply() */
export interface NormalizedTx {
  tx_id: string
  state: TxState
  station_id: string | null
  connector_id: string | null
  started_at: string | null
  ended_at: string | null
  energy_kwh: number | null
  soc_start: number | null
  soc: number | null
  power_kw: number | null
  end_reason: string | null
  raw: unknown
}

export interface ConnectorSummary {
  connector_id: string
  status: string | null
  tx: NormalizedTx | null
}

export interface StationSummary {
  station_id: string
  name: string | null
  status: string | null
  connectors: ConnectorSummary[]
}

/** Offene Sitzung aus charging_open_sessions() */
export interface OpenSession {
  id: string
  status: 'waiting' | 'charging'
  external_tx_id: string | null
  linked_at: string
  station_id: string | null
  connector_id: string | null
  charge_point_code: string
}

type Obj = Record<string, unknown>

const ENDED = new Set(['ended', 'finished', 'completed', 'stopped', 'done', 'closed'])
/** Nach dem Scan darf die Ladung höchstens so lange vorher begonnen haben (Uhrzeit-Abweichung, Anstecken vor dem Scan) */
export const LINK_GRACE_MS = 2 * 60 * 1000
const RAW_LIMIT = 8000

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  }
  return undefined
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  // Leistung kann als { present, max, avg } kommen
  if (isObj(v)) return num(pick(v, 'present', 'current', 'value'))
  return null
}

function iso(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function clampSoc(v: number | null): number | null {
  if (v === null) return null
  return Math.max(0, Math.min(100, Math.round(v)))
}

function trimRaw(raw: unknown): unknown {
  try {
    return JSON.stringify(raw).length <= RAW_LIMIT ? raw : { truncated: true }
  } catch {
    return null
  }
}

/** Liest eine Transaktion aus einer API-Antwort; null, wenn keine Transaktions-ID vorhanden ist. */
export function normalizeTransaction(input: unknown, ctx: { stationId?: string | null; connectorId?: string | null } = {}): NormalizedTx | null {
  if (!isObj(input)) return null
  const txId = str(pick(input, 'txId', 'transactionId', 'id'))
  if (!txId) return null
  const status = str(pick(input, 'status', 'state'))
  const endedAt = iso(pick(input, 'endTime', 'stopTime', 'endedAt'))
  const state: TxState = status ? (ENDED.has(status.toLowerCase()) ? 'ended' : 'charging') : endedAt ? 'ended' : 'charging'
  let energy = num(pick(input, 'chargedEnergyKwh', 'energyKwh', 'chargedEnergy'))
  if (energy === null) {
    const wh = num(pick(input, 'chargedEnergyWh', 'energyWh'))
    if (wh !== null) energy = wh / 1000
  }
  return {
    tx_id: txId,
    state,
    station_id: str(pick(input, 'stationId', 'chargingStationId')) ?? ctx.stationId ?? null,
    connector_id: str(pick(input, 'connectorId', 'evseId', 'connector', 'outletId')) ?? ctx.connectorId ?? null,
    started_at: iso(pick(input, 'startTime', 'startedAt')),
    ended_at: state === 'ended' ? endedAt : null,
    energy_kwh: energy === null ? null : Math.max(0, Math.round(energy * 1000) / 1000),
    soc_start: clampSoc(num(pick(input, 'socStart', 'startSoc', 'socAtStart'))),
    soc: clampSoc(num(pick(input, 'soc', 'socEnd', 'currentSoc', 'socCurrent'))),
    power_kw: num(pick(input, 'powerKw', 'currentPowerKw', 'power')),
    end_reason: state === 'ended' ? str(pick(input, 'chargingEndReason', 'endReason', 'stopReason')) : null,
    raw: trimRaw(input),
  }
}

function list(v: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(v)) return v
  if (isObj(v)) {
    for (const k of keys) if (Array.isArray(v[k])) return v[k] as unknown[]
  }
  return []
}

/** GET /stations → Stationen mit Connectoren und deren aktueller bzw. letzter Transaktion */
export function stationsFromResponse(json: unknown): StationSummary[] {
  return list(json, 'stations', 'chargingStations', 'items', 'data')
    .filter(isObj)
    .map((s) => {
      const stationId = str(pick(s, 'stationId', 'id', 'chargingStationId')) ?? ''
      const connectors = list(s, 'connectors', 'outlets', 'evses')
        .filter(isObj)
        .map((c, i): ConnectorSummary => {
          const connectorId = str(pick(c, 'connectorId', 'id', 'evseId', 'outletId')) ?? String(i + 1)
          const txRaw = pick(c, 'transaction', 'currentTransaction', 'activeTransaction', 'lastTransaction')
          return {
            connector_id: connectorId,
            status: str(pick(c, 'status', 'state')),
            tx: normalizeTransaction(txRaw, { stationId, connectorId }),
          }
        })
      return { station_id: stationId, name: str(pick(s, 'name', 'label')), status: str(pick(s, 'status', 'state')), connectors }
    })
    .filter((s) => s.station_id)
}

/** Kurzfassung für Einstellungen → Ladepunkte („Verbindung testen“) */
export function stationListForUi(stations: StationSummary[]): unknown[] {
  return stations.slice(0, 50).map((s) => ({
    station_id: s.station_id,
    name: s.name,
    status: s.status,
    connectors: s.connectors.map((c) => ({ connector_id: c.connector_id, status: c.status, charging: c.tx?.state === 'charging' })),
  }))
}

/** Passt der Connector der API zum eingetragenen Connector des Ladepunkts? (leer = jeder) */
export function connectorMatches(wanted: string | null, actual: string | null): boolean {
  if (!wanted) return true
  if (!actual) return false
  const a = actual.trim().toUpperCase()
  const w = wanted.trim().toUpperCase()
  // EVSE-IDs wie DE*ABC*E1234*1 enden auf die Connector-Nummer
  return a === w || a.endsWith(`*${w}`) || a.endsWith(`-${w}`)
}

/** Darf diese Transaktion einer wartenden Sitzung zugeordnet werden? */
export function fitsWaiting(session: Pick<OpenSession, 'linked_at' | 'connector_id'>, tx: NormalizedTx): boolean {
  if (!connectorMatches(session.connector_id, tx.connector_id)) return false
  if (!tx.started_at) return tx.state === 'charging'
  return new Date(tx.started_at).getTime() >= new Date(session.linked_at).getTime() - LINK_GRACE_MS
}

/** Passende Transaktionen für eine wartende Sitzung, früheste zuerst */
export function candidatesForWaiting(session: Pick<OpenSession, 'linked_at' | 'connector_id'>, txs: NormalizedTx[]): NormalizedTx[] {
  const seen = new Set<string>()
  return txs
    .filter((tx) => fitsWaiting(session, tx) && !seen.has(tx.tx_id) && !!seen.add(tx.tx_id))
    .sort((a, b) => (a.started_at ?? '9999').localeCompare(b.started_at ?? '9999'))
}

// ---------------------------------------------------------------------------------------------
// Abruf

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export interface SyncConfig {
  settings: { api_enabled?: boolean; api_base_url?: string }
  refresh_token: string
  access_token: string | null
  test_requested: boolean
}

export interface SyncDeps {
  fetch: FetchFn
  /** Aufruf einer Datenbankfunktion (service_role) */
  rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>
  config: SyncConfig
  now?: () => Date
}

export interface SyncResult {
  ok: boolean
  error?: string
  sessions: number
  linked: number
  updated: number
  ended: number
  stations: number
}

export class KempowerError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

/** Kleiner Client mit Token-Cache und einmaligem Neu-Anmelden bei 401 */
export class KempowerClient {
  private token: string | null

  constructor(
    private readonly baseUrl: string,
    private readonly refreshToken: string,
    cachedToken: string | null,
    private readonly fetchFn: FetchFn,
    private readonly storeToken: (token: string, validUntil: string) => Promise<void>,
  ) {
    this.token = cachedToken
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  }

  async refresh(): Promise<string> {
    const res = await this.fetchFn(this.url('auth/refreshAccessToken'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.refreshToken}`, Accept: 'application/json' },
    })
    if (!res.ok) throw new KempowerError(`Anmeldung bei Kempower fehlgeschlagen (HTTP ${res.status})`, res.status)
    const body = (await res.json()) as Obj
    const token = str(body?.token)
    if (!token) throw new KempowerError('Anmeldung bei Kempower: kein Token in der Antwort')
    const validUntil = iso(body.validUntil) ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString()
    this.token = token
    await this.storeToken(token, validUntil)
    return token
  }

  async get(path: string): Promise<unknown> {
    if (!this.token) await this.refresh()
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchFn(this.url(path), {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      })
      if (res.status === 401 && attempt === 0) {
        await this.refresh()
        continue
      }
      if (res.status === 404) return null
      if (!res.ok) throw new KempowerError(`Kempower ${path.split('?')[0]}: HTTP ${res.status}`, res.status)
      return res.json()
    }
    throw new KempowerError('Kempower: nicht angemeldet', 401)
  }
}

/**
 * Ein Abruf: Stationen holen, wartende Sitzungen zuordnen, laufende aktualisieren.
 * Fehler einzelner Sitzungen brechen den Lauf nicht ab; der Gesamtstatus geht an charging_sync_finished().
 */
export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { ok: true, sessions: 0, linked: 0, updated: 0, ended: 0, stations: 0 }
  const { config } = deps
  const finish = async (ok: boolean, error?: string, stations?: unknown[]) => {
    result.ok = ok
    if (error) result.error = error
    await deps.rpc('charging_sync_finished', { p_ok: ok, p_error: error ?? null, p_stations: stations ?? null })
    return result
  }

  if (!config.settings.api_enabled) return finish(false, 'Schnittstelle ist in den Einstellungen ausgeschaltet')
  if (!config.refresh_token) return finish(false, 'Kein Kempower-Refresh-Token hinterlegt (Vault kempower_refresh_token)')

  const client = new KempowerClient(
    config.settings.api_base_url || 'https://kempower.io/api',
    config.refresh_token,
    config.access_token,
    deps.fetch,
    async (token, validUntil) => {
      await deps.rpc('charging_store_token', { p_token: token, p_valid_until: validUntil })
    },
  )

  const sessions = ((await deps.rpc('charging_open_sessions')) ?? []) as OpenSession[]
  result.sessions = sessions.length

  let stations: StationSummary[]
  try {
    stations = stationsFromResponse(await client.get('stations'))
  } catch (e) {
    return finish(false, (e as Error).message)
  }
  result.stations = stations.length

  const errors: string[] = []
  const apply = async (session: OpenSession, tx: NormalizedTx) => {
    const outcome = (await deps.rpc('charging_apply', { p_session_id: session.id, p_tx: tx })) as string
    if (outcome === 'linked') result.linked++
    else if (outcome === 'ended') result.ended++
    else if (outcome === 'updated') result.updated++
    return outcome
  }

  for (const session of sessions) {
    try {
      const station = stations.find((s) => s.station_id === session.station_id)
      if (session.status === 'charging' && session.external_tx_id) {
        const fromStation = station?.connectors.map((c) => c.tx).find((tx) => tx?.tx_id === session.external_tx_id) ?? null
        // Läuft die Transaktion laut Station noch, reicht deren Stand; sonst Endstand einzeln holen
        let tx = fromStation?.state === 'charging' ? fromStation : null
        if (!tx) {
          tx = normalizeTransaction(await client.get(`transactions/${encodeURIComponent(session.external_tx_id)}`), {
            stationId: session.station_id,
            connectorId: session.connector_id,
          })
        }
        if (tx) await apply(session, tx)
        continue
      }

      if (!session.station_id) {
        errors.push(`${session.charge_point_code}: keine Station-ID eingetragen`)
        continue
      }
      const fromStation = (station?.connectors ?? []).map((c) => c.tx).filter((tx): tx is NormalizedTx => !!tx)
      let candidates = candidatesForWaiting(session, fromStation)
      if (candidates.length === 0) {
        // Kurze Ladung schon beendet? → Transaktionen der Station seit dem Scan
        const since = new Date(new Date(session.linked_at).getTime() - LINK_GRACE_MS).toISOString()
        const body = await client.get(
          `chargingStations/${encodeURIComponent(session.station_id)}/transactions?filterStartTime=${encodeURIComponent('>=' + since)}`,
        )
        const recent = list(body, 'transactions', 'items', 'data')
          .map((t) => normalizeTransaction(t, { stationId: session.station_id }))
          .filter((t): t is NormalizedTx => !!t)
        candidates = candidatesForWaiting(session, recent)
      }
      // Bereits einer anderen Buchung zugeordnete Transaktionen überspringen
      for (const tx of candidates) {
        if ((await apply(session, tx)) !== 'taken') break
      }
    } catch (e) {
      errors.push(`${session.charge_point_code}: ${(e as Error).message}`)
    }
  }

  return finish(errors.length === 0, errors.length ? errors.join('; ').slice(0, 500) : undefined, stationListForUi(stations))
}
