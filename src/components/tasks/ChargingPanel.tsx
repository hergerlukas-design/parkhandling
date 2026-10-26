import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  applyChargingPrice,
  berlinTimeOnDay,
  cancelCharging,
  DISPLAY_CODE_HINT,
  durationLabel,
  formatKwh,
  listTaskSessions,
  loadChargingSettings,
  OPEN_STATUSES,
  parseChargeScan,
  parseKwh,
  parseSoc,
  perKwhBilling,
  saveManualCharging,
  SESSION_STATUS,
  startCharging,
  timeInputValue,
  type ChargingSession,
  type ChargingSettings,
  type StartResult,
} from '../../lib/charging/charging'
import { formatDateTime, formatMoney, formatTime } from '../../lib/format'
import { moveVehicle } from '../../lib/siteplan'
import type { BoardTask } from '../../lib/tasks'
import { QrScanner } from '../QrScanner'
import { Button, ErrorList, Field, TextInput } from '../ui'

/** Abfrage während einer offenen Ladung: schnell, solange auf den Ladestart gewartet wird */
const POLL_WAITING_MS = 20_000
const POLL_CHARGING_MS = 60_000

/**
 * Aufgabe „Laden“: Aufkleber am Ladepunkt scannen, Ladestand live verfolgen, Werte von Hand
 * eintragen (ohne Schnittstelle oder wenn die Säule nichts geliefert hat), Abrechnung pro kWh übernehmen.
 */
export function ChargingPanel({ task, onChanged }: { task: BoardTask; onChanged: () => void }) {
  const [sessions, setSessions] = useState<ChargingSession[]>([])
  const [settings, setSettings] = useState<ChargingSettings | null>(null)
  const [scanning, setScanning] = useState(false)
  const [hint, setHint] = useState<StartResult['location_hint']>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const load = useCallback(async () => {
    try {
      const [list, cfg] = await Promise.all([listTaskSessions(task.id), loadChargingSettings()])
      setSessions(list)
      setSettings(cfg)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [task.id])

  useEffect(() => {
    void load()
  }, [load])

  const open = sessions.find((s) => OPEN_STATUSES.includes(s.status)) ?? null
  const history = sessions.filter((s) => s !== open)
  const needsEntry = open?.status === 'manual'

  // Laufende Ladung regelmäßig neu laden, solange die Aufgabe offen ist
  useEffect(() => {
    if (!open || open.status === 'manual') return
    const timer = setInterval(() => {
      void listTaskSessions(task.id).then((list) => {
        setSessions(list)
        const before = open.status
        const now = list.find((s) => s.id === open.id)?.status
        if (now && now !== before) onChanged()
      }).catch(() => undefined)
    }, open.status === 'waiting' ? POLL_WAITING_MS : POLL_CHARGING_MS)
    return () => clearInterval(timer)
  }, [open, task.id, onChanged])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onScan(raw: string) {
    if (busy) return
    const scan = parseChargeScan(raw)
    if (scan.kind === 'display') {
      setError(DISPLAY_CODE_HINT)
      return
    }
    if (scan.kind === 'other') {
      setError(`„${scan.text}“ ist kein Ladepunkt. Bitte den Aufkleber PF-CHG am Ladepunkt scannen.`)
      return
    }
    await run(async () => {
      const result = await startCharging(task.id, scan.code)
      setScanning(false)
      setHint(result.location_hint)
    })
  }

  const taskClosed = task.status === 'done' || task.status === 'cancelled'

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Ladung</h3>

      {hint && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm">
          <span>Das Fahrzeug steht laut Lageplan nicht auf {hint.name ?? hint.code}.</span>
          <span className="flex gap-2">
            <Button disabled={busy} onClick={() => void run(async () => {
              await moveVehicle(task.booking_id, hint.code, 'Laden')
              setHint(null)
            })}>
              Auf {hint.name ?? hint.code} umbuchen
            </Button>
            <Button disabled={busy} onClick={() => setHint(null)}>Nein</Button>
          </span>
        </div>
      )}

      {open && <SessionCard session={open} />}

      {open && needsEntry && (
        <ManualEntry session={open} busy={busy} onSave={(values) => run(() => saveManualCharging(open.id, values))} />
      )}

      {open && (
        <div className="flex flex-wrap gap-2">
          {!confirmCancel ? (
            <Button disabled={busy} onClick={() => setConfirmCancel(true)}>Ladung trennen</Button>
          ) : (
            <>
              <span className="self-center text-sm text-subtle">Falsch gescannt oder abgebrochen?</span>
              <Button variant="danger" disabled={busy} onClick={() => void run(async () => {
                await cancelCharging(open.id, 'in der App getrennt')
                setConfirmCancel(false)
              })}>
                Ja, trennen
              </Button>
              <Button disabled={busy} onClick={() => setConfirmCancel(false)}>Abbrechen</Button>
            </>
          )}
        </div>
      )}

      {!open && !taskClosed && !scanning && (
        <Button variant="primary" disabled={busy} onClick={() => { setError(null); setScanning(true) }}>
          Ladung starten – Ladepunkt scannen
        </Button>
      )}

      {scanning && (
        <div className="flex flex-col gap-2">
          <QrScanner onResult={(t) => void onScan(t)} label="Aufkleber am Ladepunkt scannen (nicht das Display)" paused={busy} placeholder="z. B. LP1" />
          <Button onClick={() => setScanning(false)}>Abbrechen</Button>
        </div>
      )}

      <ErrorList errors={error ? [error] : []} />

      {history.length > 0 && (
        <ul className="flex flex-col gap-2">
          {history.map((s) => (
            <li key={s.id} className="flex flex-col gap-2">
              <SessionCard session={s} compact />
              {s.status === 'failed' && !open && !taskClosed && (
                <ManualEntry session={s} busy={busy} collapsed onSave={(values) => run(() => saveManualCharging(s.id, values))} />
              )}
              {settings && <Billing session={s} settings={settings} busy={busy} onApply={() => run(() => applyChargingPrice(s.id))} />}
            </li>
          ))}
        </ul>
      )}

      {!open && history.some((s) => s.status === 'ended') && task.status === 'in_progress' && (
        <p className="text-sm text-ok">Ladung beendet – Aufgabe abschließen?</p>
      )}
    </section>
  )
}

function SessionCard({ session: s, compact = false }: { session: ChargingSession; compact?: boolean }) {
  const st = SESSION_STATUS[s.status]
  const socText = s.soc_start !== null || s.soc_end !== null
    ? `${s.soc_start ?? '–'} % → ${s.soc_end ?? '–'} %`
    : '–'
  return (
    <div className={`rounded-xl border border-line p-3 ${compact ? 'bg-ground' : 'bg-surface'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{s.charge_point_label ?? s.charge_point_code} <span className="font-mono text-sm text-subtle">{s.charge_point_code}</span></span>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${st.className}`}>{st.label}</span>
      </div>
      {s.status === 'waiting' && (
        <p className="mt-1 text-sm text-subtle">Ladepunkt erkannt. Die Ladung wird automatisch übernommen, sobald die Säule lädt.</p>
      )}
      {s.status === 'manual' && (
        <p className="mt-1 text-sm text-subtle">Keine Schnittstelle zur Säule – bitte nach dem Laden die Werte vom Display eintragen.</p>
      )}
      {(s.status === 'charging' || s.status === 'ended') && (
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-subtle">Energie</dt><dd className="text-base font-semibold">{formatKwh(s.energy_kwh)}</dd></div>
          <div><dt className="text-xs text-subtle">Ladestand</dt><dd>{socText}</dd></div>
          {s.status === 'charging'
            ? <div><dt className="text-xs text-subtle">Leistung</dt><dd>{s.power_kw !== null ? `${String(s.power_kw).replace('.', ',')} kW` : '–'}</dd></div>
            : <div><dt className="text-xs text-subtle">Ende</dt><dd>{s.ended_at ? formatTime(s.ended_at) : '–'}</dd></div>}
          <div><dt className="text-xs text-subtle">Dauer</dt><dd>{durationLabel(s.started_at ?? s.linked_at, s.ended_at)}</dd></div>
        </dl>
      )}
      <p className="mt-2 text-xs text-muted">
        Gescannt {formatDateTime(s.linked_at)}{s.linked_by_name ? ` von ${s.linked_by_name}` : ''}
        {s.source === 'manual' && s.status === 'ended' ? ' · Werte von Hand' : ''}
        {s.source === 'api' && s.last_polled_at ? ` · Säule abgefragt ${formatTime(s.last_polled_at)}` : ''}
        {s.end_reason ? ` · ${s.end_reason}` : ''}
      </p>
    </div>
  )
}

function ManualEntry({
  session,
  busy,
  collapsed = false,
  onSave,
}: {
  session: ChargingSession
  busy: boolean
  collapsed?: boolean
  onSave: (values: { energyKwh: number; startedAt: string | null; endedAt: string | null; socStart: number | null; socEnd: number | null }) => Promise<void>
}) {
  const [show, setShow] = useState(!collapsed)
  const [kwh, setKwh] = useState('')
  const [socStart, setSocStart] = useState('')
  const [socEnd, setSocEnd] = useState('')
  const [start, setStart] = useState(() => timeInputValue(session.started_at ?? session.linked_at))
  const [end, setEnd] = useState(() => timeInputValue(new Date().toISOString()))
  const [error, setError] = useState<string | null>(null)

  if (!show) {
    return <Button disabled={busy} onClick={() => setShow(true)}>Werte von Hand eintragen</Button>
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const energy = parseKwh(kwh)
    const from = parseSoc(socStart)
    const to = parseSoc(socEnd)
    const base = session.started_at ?? session.linked_at
    const startedAt = start ? berlinTimeOnDay(base, start) : null
    const endedAt = end ? berlinTimeOnDay(base, end, startedAt) : null
    if (energy === null) return setError('Energie in kWh angeben, z. B. 23,4')
    if (from === undefined || to === undefined) return setError('Ladestand bitte als ganze Zahl von 0 bis 100')
    if ((start && !startedAt) || (end && !endedAt)) return setError('Uhrzeit bitte als HH:MM')
    setError(null)
    await onSave({ energyKwh: energy, startedAt, endedAt, socStart: from, socEnd: to })
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <p className="text-sm text-subtle">Werte vom Display der Ladesäule bzw. aus dem Fahrzeug übernehmen.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="Energie (kWh)" className="col-span-2 sm:col-span-1">
          <TextInput inputMode="decimal" value={kwh} onChange={(e) => setKwh(e.target.value)} placeholder="23,4" required />
        </Field>
        <Field label="Ladestand von %">
          <TextInput inputMode="numeric" value={socStart} onChange={(e) => setSocStart(e.target.value)} placeholder="20" />
        </Field>
        <Field label="bis %">
          <TextInput inputMode="numeric" value={socEnd} onChange={(e) => setSocEnd(e.target.value)} placeholder="80" />
        </Field>
        <Field label="Beginn">
          <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Ende">
          <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <ErrorList errors={error ? [error] : []} />
      <div className="flex justify-end gap-2">
        {collapsed && <Button disabled={busy} onClick={() => setShow(false)}>Abbrechen</Button>}
        <Button type="submit" variant="primary" disabled={busy}>Ladung speichern</Button>
      </div>
    </form>
  )
}

function Billing({
  session,
  settings,
  busy,
  onApply,
}: {
  session: ChargingSession
  settings: ChargingSettings
  busy: boolean
  onApply: () => void
}) {
  if (session.status !== 'ended') return null
  if (session.amount !== null) {
    return <p className="text-sm text-subtle">In Buchung übernommen: {formatMoney(Number(session.amount))}</p>
  }
  const billing = perKwhBilling(session, settings)
  if (!billing) return null
  if (!billing.ok) return <p className="text-sm text-subtle">Abrechnung: {billing.reason}</p>
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ground px-3 py-2 text-sm">
      <span>{billing.label}</span>
      <Button disabled={busy} onClick={onApply}>In Buchung übernehmen</Button>
    </div>
  )
}
