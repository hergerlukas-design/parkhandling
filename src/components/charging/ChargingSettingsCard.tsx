import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  DEFAULT_CHARGING_SETTINGS,
  listChargePoints,
  loadChargingSettings,
  loadChargingStatus,
  requestChargingTest,
  saveChargePoint,
  saveChargingSettings,
  type ChargePoint,
  type ChargePointInput,
  type ChargingApiStatus,
  type ChargingSettings,
} from '../../lib/charging/charging'
import { formatDateTime, formatMoney } from '../../lib/format'
import { loadBoard, type BoardSlot } from '../../lib/siteplan'
import { Button, Dialog, ErrorList, Field, Select, TextInput } from '../ui'

const EMPTY_POINT: ChargePointInput = {
  code: '',
  label: '',
  location_id: null,
  provider: 'manual',
  station_id: '',
  connector_id: '',
  legal_metering: false,
  active: true,
}

/** Admin: Laden – Schnittstelle, Abrechnung, Ladepunkte mit QR-Aufklebern */
export function ChargingSettingsCard() {
  const [settings, setSettings] = useState<ChargingSettings>(DEFAULT_CHARGING_SETTINGS)
  const [price, setPrice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [points, setPoints] = useState<ChargePoint[]>([])
  const [places, setPlaces] = useState<BoardSlot[]>([])
  const [status, setStatus] = useState<ChargingApiStatus | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; input: ChargePointInput } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  async function reload() {
    try {
      const [cfg, cps, board, st] = await Promise.all([
        loadChargingSettings(),
        listChargePoints(),
        loadBoard(),
        loadChargingStatus().catch(() => null),
      ])
      setSettings(cfg)
      setPrice(cfg.price_per_kwh != null ? String(cfg.price_per_kwh).replace('.', ',') : '')
      setPoints(cps)
      setPlaces(board.filter((s) => s.area === 'work' || s.area === 'buffer'))
      setStatus(st)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  function change<K extends keyof ChargingSettings>(key: K, value: ChargingSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }))
    setDirty(true)
  }

  async function save() {
    const p = price.trim() ? Number(price.trim().replace(',', '.')) : null
    if (p !== null && (!Number.isFinite(p) || p <= 0 || p > 10)) {
      setError('Preis pro kWh bitte als Betrag wie 0,49 angeben')
      return
    }
    if (settings.billing_mode === 'per_kwh' && p === null) {
      setError('Für die Abrechnung pro kWh einen Preis pro kWh angeben')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveChargingSettings({ ...settings, price_per_kwh: p })
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setTesting(true)
    setError(null)
    try {
      const started = await requestChargingTest()
      if (!started) {
        setError('Abruf nicht gestartet: Vault-Einträge charging_sync_url und charging_sync_secret fehlen (README, Abschnitt Laden).')
        return
      }
      // Ergebnis kommt asynchron von der Edge Function
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const st = await loadChargingStatus()
        setStatus(st)
        if (!st.test_requested_at) break
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  async function savePoint() {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      await saveChargePoint(editing.id, editing.input)
      setEditing(null)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const placeName = (id: string | null) => places.find((p) => p.id === id)?.name ?? places.find((p) => p.id === id)?.code ?? '–'

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Schnittstelle & Abrechnung</h3>
        <label className="touch-target flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-accent" checked={settings.api_enabled}
            onChange={(e) => change('api_enabled', e.target.checked)} />
          Kempower-Schnittstelle nutzen (Werte automatisch aus der Ladesäule)
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Abrechnung">
            <Select value={settings.billing_mode} onChange={(e) => change('billing_mode', e.target.value as ChargingSettings['billing_mode'])}>
              <option value="flat">Pauschale über die Leistung „Laden“</option>
              <option value="per_kwh">Pro kWh (nur eichrechtskonforme Ladepunkte)</option>
            </Select>
          </Field>
          <Field label="Preis pro kWh (€)">
            <TextInput inputMode="decimal" value={price} placeholder="0,49" onChange={(e) => { setPrice(e.target.value); setDirty(true) }} />
          </Field>
          <Field label="Abfrage alle … Minuten">
            <TextInput type="number" min={1} max={60} value={settings.poll_interval_minutes}
              onChange={(e) => change('poll_interval_minutes', Math.max(1, Math.min(60, Number(e.target.value) || 5)))} />
          </Field>
          <Field label="Auf Ladestart warten (Minuten)">
            <TextInput type="number" min={1} max={120} value={settings.link_window_minutes}
              onChange={(e) => change('link_window_minutes', Math.max(1, Math.min(120, Number(e.target.value) || 15)))} />
          </Field>
        </div>
        <label className="touch-target flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-accent" checked={settings.auto_complete_task}
            onChange={(e) => change('auto_complete_task', e.target.checked)} />
          Aufgabe „Laden“ bei Ladeende automatisch abschließen
        </label>
        {settings.billing_mode === 'per_kwh' && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">
            Abrechnung nach kWh gegenüber Kunden setzt eine eichrechtskonforme Messung voraus. Die App lässt die Übernahme
            nur bei Ladepunkten mit „eichrechtskonform“ und Werten aus der Säule zu.
            {settings.price_per_kwh ? ` Aktuell ${formatMoney(settings.price_per_kwh)} pro kWh.` : ''}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>Speichern</Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Verbindung zu Kempower</h3>
          <Button disabled={testing} onClick={() => void test()}>{testing ? 'Prüfe …' : 'Verbindung testen'}</Button>
        </div>
        <dl className="text-sm">
          <div className="flex justify-between gap-4 py-1"><dt className="text-muted">Refresh-Token</dt>
            <dd>{status?.refresh_token_in_vault ? 'im Vault hinterlegt' : 'fehlt (Vault kempower_refresh_token)'}</dd></div>
          <div className="flex justify-between gap-4 py-1"><dt className="text-muted">Letzter Abruf</dt>
            <dd>{status?.last_sync_at ? formatDateTime(status.last_sync_at) : '–'}</dd></div>
          <div className="flex justify-between gap-4 py-1"><dt className="text-muted">Zuletzt erfolgreich</dt>
            <dd>{status?.last_success_at ? formatDateTime(status.last_success_at) : '–'}</dd></div>
        </dl>
        {status?.last_error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-ink">{status.last_error}</p>}
        {status && status.stations.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-subtle">Stationen laut Kempower (Station-ID und Connector für die Ladepunkte):</p>
            <ul className="flex flex-col gap-1">
              {status.stations.map((s) => (
                <li key={s.station_id} className="rounded-lg bg-ground px-3 py-1.5">
                  <span className="font-mono">{s.station_id}</span>{s.name ? ` · ${s.name}` : ''}{s.status ? ` · ${s.status}` : ''}
                  <span className="block text-xs text-subtle">
                    Connectoren: {s.connectors.map((c) => `${c.connector_id}${c.charging ? ' (lädt)' : ''}`).join(', ') || '–'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Ladepunkte</h3>
          <span className="flex gap-2">
            <Link to="/ladepunkte" className="touch-target inline-flex items-center rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold">
              QR-Aufkleber drucken
            </Link>
            <Button onClick={() => setEditing({ id: null, input: { ...EMPTY_POINT } })}>Neuer Ladepunkt</Button>
          </span>
        </div>
        <ul className="flex flex-col gap-2">
          {points.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setEditing({ id: p.id, input: { ...p } })}
                className="touch-target flex w-full items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-left text-sm hover:bg-ground">
                <span>
                  <span className="block font-semibold">{p.code}{p.label ? ` · ${p.label}` : ''}{!p.active ? ' (inaktiv)' : ''}</span>
                  <span className="block text-xs text-subtle">
                    {placeName(p.location_id)} · {p.provider === 'kempower' ? `Kempower ${p.station_id ?? 'ohne Station-ID'}${p.connector_id ? ` / ${p.connector_id}` : ''}` : 'Werte von Hand'}
                  </span>
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${p.legal_metering ? 'bg-ok-soft text-ok-ink' : 'bg-chip text-subtle'}`}>
                  {p.legal_metering ? 'eichrechtskonform' : 'nicht eichrechtskonform'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <ErrorList errors={error ? [error] : []} />

      {editing && (
        <Dialog
          title={editing.id ? `Ladepunkt ${editing.input.code}` : 'Neuer Ladepunkt'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Abbrechen</Button>
              <Button variant="primary" disabled={busy || !editing.input.code.trim()} onClick={() => void savePoint()}>Speichern</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code (auf dem Aufkleber)">
              <TextInput value={editing.input.code} disabled={!!editing.id} placeholder="LP3" autoCapitalize="characters"
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, code: e.target.value.toUpperCase() } })} />
            </Field>
            <Field label="Bezeichnung">
              <TextInput value={editing.input.label ?? ''} placeholder="Ladeplatz 3"
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, label: e.target.value } })} />
            </Field>
            <Field label="Steht an">
              <Select value={editing.input.location_id ?? ''}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, location_id: e.target.value || null } })}>
                <option value="">– kein fester Platz –</option>
                {places.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.code}</option>)}
              </Select>
            </Field>
            <Field label="Werte">
              <Select value={editing.input.provider}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, provider: e.target.value as ChargePointInput['provider'] } })}>
                <option value="manual">von Hand eintragen</option>
                <option value="kempower">aus Kempower (Schnittstelle)</option>
              </Select>
            </Field>
            {editing.input.provider === 'kempower' && (
              <>
                <Field label="Station-ID (ChargEye)">
                  <TextInput value={editing.input.station_id ?? ''} placeholder="charger1"
                    onChange={(e) => setEditing({ ...editing, input: { ...editing.input, station_id: e.target.value } })} />
                </Field>
                <Field label="Connector (leer = jeder)">
                  <TextInput value={editing.input.connector_id ?? ''} placeholder="1"
                    onChange={(e) => setEditing({ ...editing, input: { ...editing.input, connector_id: e.target.value } })} />
                </Field>
              </>
            )}
            <label className="touch-target flex items-center gap-3 text-sm sm:col-span-2">
              <input type="checkbox" className="size-5 accent-accent" checked={editing.input.legal_metering}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, legal_metering: e.target.checked } })} />
              Eichrechtskonforme Messung (erlaubt Abrechnung pro kWh)
            </label>
            <label className="touch-target flex items-center gap-3 text-sm sm:col-span-2">
              <input type="checkbox" className="size-5 accent-accent" checked={editing.input.active}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, active: e.target.checked } })} />
              Aktiv (kann gescannt werden)
            </label>
          </div>
        </Dialog>
      )}
    </div>
  )
}
