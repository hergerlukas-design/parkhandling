import { describe, expect, it } from 'vitest'
import {
  candidatesForWaiting,
  connectorMatches,
  normalizeTransaction,
  runSync,
  stationsFromResponse,
  type FetchFn,
  type OpenSession,
  type SyncConfig,
} from '../../../supabase/functions/_shared/kempower'
import stationsFixture from './__fixtures__/kempower-stations.json'
import endedFixture from './__fixtures__/kempower-transaction-ended.json'

describe('normalizeTransaction', () => {
  it('liest eine laufende Transaktion inkl. Leistung als Objekt', () => {
    const tx = normalizeTransaction(stationsFixture.stations[0].connectors[0].transaction)
    expect(tx).toMatchObject({
      tx_id: 'tx-0001',
      state: 'charging',
      station_id: 'charger1',
      connector_id: 'DE*TST*E0001*1',
      started_at: '2026-10-26T10:05:00.000Z',
      ended_at: null,
      energy_kwh: 7.25,
      soc_start: 31,
      soc: 44,
      power_kw: 98.4,
      end_reason: null,
    })
  })

  it('liest eine beendete Transaktion und rundet kWh auf 3 Stellen', () => {
    const tx = normalizeTransaction(endedFixture)
    expect(tx).toMatchObject({ state: 'ended', energy_kwh: 23.412, soc: 80, end_reason: 'ChargingStateChanged' })
    expect(tx?.ended_at).toBe('2026-10-26T10:52:30.000Z')
  })

  it('akzeptiert Varianten: Wh, Endzeit ohne Status, SoC außerhalb des Bereichs', () => {
    const tx = normalizeTransaction({ transactionId: 'x1', chargedEnergyWh: 1500, endTime: '2026-10-26T12:00:00Z', soc: 104 })
    expect(tx).toMatchObject({ tx_id: 'x1', state: 'ended', energy_kwh: 1.5, soc: 100 })
  })

  it('ohne Transaktions-ID → null', () => {
    expect(normalizeTransaction({ status: 'Charging' })).toBeNull()
    expect(normalizeTransaction(null)).toBeNull()
  })
})

describe('stationsFromResponse', () => {
  it('liefert Stationen mit Connectoren und Transaktionen', () => {
    const stations = stationsFromResponse(stationsFixture)
    expect(stations).toHaveLength(1)
    expect(stations[0].connectors.map((c) => [c.connector_id, c.tx?.tx_id, c.tx?.state])).toEqual([
      ['1', 'tx-0001', 'charging'],
      ['2', 'tx-0000', 'ended'],
    ])
  })
})

describe('Zuordnung', () => {
  it('Connector: leer = jeder, Nummer passt auf EVSE-ID', () => {
    expect(connectorMatches(null, 'DE*TST*E0001*2')).toBe(true)
    expect(connectorMatches('1', 'DE*TST*E0001*1')).toBe(true)
    expect(connectorMatches('1', 'DE*TST*E0001*2')).toBe(false)
    expect(connectorMatches('2', '2')).toBe(true)
  })

  it('nimmt nur Transaktionen ab dem Scan (2 min Spielraum) am richtigen Connector', () => {
    const stations = stationsFromResponse(stationsFixture)
    const txs = stations[0].connectors.flatMap((c) => (c.tx ? [c.tx] : []))
    // Scan 10:06 → Ladung ab 10:05 passt (Spielraum), alte Ladung von 06:00 nicht
    expect(candidatesForWaiting({ linked_at: '2026-10-26T10:06:00Z', connector_id: null }, txs).map((t) => t.tx_id)).toEqual(['tx-0001'])
    // Scan 10:10 → 10:05 liegt vor dem Spielraum
    expect(candidatesForWaiting({ linked_at: '2026-10-26T10:10:00Z', connector_id: null }, txs)).toEqual([])
    // Falscher Connector
    expect(candidatesForWaiting({ linked_at: '2026-10-26T10:06:00Z', connector_id: '2' }, txs)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------

function fakeFetch(routes: Record<string, { status: number; body?: unknown }[]>) {
  const calls: { url: string; auth?: string }[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization })
    const key = Object.keys(routes).find((k) => url.includes(k))
    const queue = key ? routes[key] : undefined
    const next = queue && (queue.length > 1 ? queue.shift()! : queue[0])
    if (!next) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: next.status < 400, status: next.status, json: async () => next.body }
  }
  return { fn, calls }
}

function fakeDb(sessions: OpenSession[], applyResult: (id: string, tx: { tx_id: string }) => string = () => 'linked') {
  const calls: { name: string; args?: Record<string, unknown> }[] = []
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args })
    if (name === 'charging_open_sessions') return sessions
    if (name === 'charging_apply') return applyResult(args!.p_session_id as string, args!.p_tx as { tx_id: string })
    return null
  }
  return { rpc, calls }
}

const config: SyncConfig = {
  settings: { api_enabled: true, api_base_url: 'https://api.test/api' },
  refresh_token: 'refresh-secret',
  access_token: null,
  test_requested: false,
}

const waiting: OpenSession = {
  id: 's-1',
  status: 'waiting',
  external_tx_id: null,
  linked_at: '2026-10-26T10:06:00Z',
  station_id: 'charger1',
  connector_id: '1',
  charge_point_code: 'LP2',
}

describe('runSync', () => {
  it('meldet sich an, merkt das Token, ordnet die laufende Ladung zu und meldet den Erfolg', async () => {
    const http = fakeFetch({
      'auth/refreshAccessToken': [{ status: 200, body: { token: 'jwt-1', validUntil: '2026-10-26T18:00:00Z' } }],
      '/stations': [{ status: 200, body: stationsFixture }],
    })
    const db = fakeDb([waiting])
    const result = await runSync({ fetch: http.fn, rpc: db.rpc, config })

    expect(result).toMatchObject({ ok: true, sessions: 1, linked: 1, stations: 1 })
    expect(http.calls[0]).toEqual({ url: 'https://api.test/api/auth/refreshAccessToken', auth: 'Bearer refresh-secret' })
    expect(http.calls[1].auth).toBe('Bearer jwt-1')
    expect(db.calls.find((c) => c.name === 'charging_store_token')?.args).toEqual({
      p_token: 'jwt-1',
      p_valid_until: '2026-10-26T18:00:00.000Z',
    })
    const applied = db.calls.find((c) => c.name === 'charging_apply')
    expect(applied?.args?.p_session_id).toBe('s-1')
    expect((applied?.args?.p_tx as { tx_id: string }).tx_id).toBe('tx-0001')
    const finished = db.calls.find((c) => c.name === 'charging_sync_finished')
    expect(finished?.args).toMatchObject({ p_ok: true, p_error: null })
    expect((finished?.args?.p_stations as unknown[]).length).toBe(1)
  })

  it('nutzt das gecachte Token und meldet sich bei 401 einmal neu an', async () => {
    const http = fakeFetch({
      '/stations': [{ status: 401 }, { status: 200, body: { stations: [] } }],
      'auth/refreshAccessToken': [{ status: 200, body: { token: 'jwt-neu' } }],
    })
    const db = fakeDb([])
    const result = await runSync({ fetch: http.fn, rpc: db.rpc, config: { ...config, access_token: 'jwt-alt' } })
    expect(result.ok).toBe(true)
    expect(http.calls.map((c) => c.auth)).toEqual(['Bearer jwt-alt', 'Bearer refresh-secret', 'Bearer jwt-neu'])
  })

  it('holt den Endstand einer laufenden Sitzung einzeln, wenn die Station sie nicht mehr zeigt', async () => {
    const http = fakeFetch({
      '/stations': [{ status: 200, body: { stations: [{ stationId: 'charger1', connectors: [{ connectorId: 1, status: 'Available' }] }] } }],
      'transactions/tx-0001': [{ status: 200, body: endedFixture }],
    })
    const db = fakeDb([{ ...waiting, status: 'charging', external_tx_id: 'tx-0001' }], () => 'ended')
    const result = await runSync({ fetch: http.fn, rpc: db.rpc, config: { ...config, access_token: 'jwt' } })
    expect(result).toMatchObject({ ok: true, ended: 1 })
    const tx = db.calls.find((c) => c.name === 'charging_apply')?.args?.p_tx as { state: string; energy_kwh: number }
    expect(tx).toMatchObject({ state: 'ended', energy_kwh: 23.412 })
  })

  it('sucht kurze, schon beendete Ladungen in der Transaktionsliste der Station', async () => {
    const short = { txId: 'tx-kurz', evseId: 'DE*TST*E0001*1', status: 'Ended', startTime: '2026-10-26T10:07:00Z', endTime: '2026-10-26T10:09:00Z', chargedEnergyKwh: 1.1 }
    const http = fakeFetch({
      '/stations': [{ status: 200, body: { stations: [{ stationId: 'charger1', connectors: [{ connectorId: 1, status: 'Available' }] }] } }],
      'chargingStations/charger1/transactions': [{ status: 200, body: { transactions: [short] } }],
    })
    const db = fakeDb([waiting], () => 'ended')
    const result = await runSync({ fetch: http.fn, rpc: db.rpc, config: { ...config, access_token: 'jwt' } })
    expect(result.ended).toBe(1)
    expect(http.calls[1].url).toContain('filterStartTime=%3E%3D2026-10-26T10%3A04%3A00.000Z')
  })

  it('überspringt Transaktionen, die schon einer anderen Buchung gehören', async () => {
    const two = {
      stations: [{
        stationId: 'charger1',
        connectors: [
          { connectorId: 1, transaction: { txId: 'tx-a', evseId: '1', status: 'Charging', startTime: '2026-10-26T10:06:30Z' } },
          { connectorId: 1, transaction: { txId: 'tx-b', evseId: '1', status: 'Charging', startTime: '2026-10-26T10:07:00Z' } },
        ],
      }],
    }
    const http = fakeFetch({ '/stations': [{ status: 200, body: two }] })
    const db = fakeDb([waiting], (_id, tx) => (tx.tx_id === 'tx-a' ? 'taken' : 'linked'))
    const result = await runSync({ fetch: http.fn, rpc: db.rpc, config: { ...config, access_token: 'jwt' } })
    expect(result.linked).toBe(1)
    expect(db.calls.filter((c) => c.name === 'charging_apply').map((c) => (c.args?.p_tx as { tx_id: string }).tx_id)).toEqual(['tx-a', 'tx-b'])
  })

  it('ohne Refresh-Token oder bei ausgeschalteter API: kein Abruf, Fehler gemerkt', async () => {
    const http = fakeFetch({})
    const db = fakeDb([waiting])
    const r1 = await runSync({ fetch: http.fn, rpc: db.rpc, config: { ...config, refresh_token: '' } })
    expect(r1).toMatchObject({ ok: false })
    expect(r1.error).toContain('Refresh-Token')
    const r2 = await runSync({ fetch: http.fn, rpc: db.rpc, config: { ...config, settings: { api_enabled: false } } })
    expect(r2.error).toContain('ausgeschaltet')
    expect(http.calls).toHaveLength(0)
  })

  it('Anmeldung abgelehnt → Fehler mit HTTP-Status', async () => {
    const http = fakeFetch({ 'auth/refreshAccessToken': [{ status: 403 }] })
    const db = fakeDb([waiting])
    const result = await runSync({ fetch: http.fn, rpc: db.rpc, config })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('HTTP 403')
    expect(db.calls.find((c) => c.name === 'charging_sync_finished')?.args?.p_ok).toBe(false)
  })

  it('Ladepunkt ohne Station-ID wird gemeldet', async () => {
    const http = fakeFetch({ '/stations': [{ status: 200, body: stationsFixture }] })
    const db = fakeDb([{ ...waiting, station_id: null }])
    const result = await runSync({ fetch: http.fn, rpc: db.rpc, config: { ...config, access_token: 'jwt' } })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('LP2: keine Station-ID')
  })
})
