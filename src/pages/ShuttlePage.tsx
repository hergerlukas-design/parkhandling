import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Icon } from '../components/Icon'
import { Button, Dialog, Field, Select, TextInput } from '../components/ui'
import { useAuth } from '../lib/auth'
import { formatDate, formatTime } from '../lib/format'
import {
  capacityState,
  dayRange,
  DIRECTION_LABEL,
  driverShuttleHint,
  isValet,
  meetingTerminal,
  routeLabel,
  tripLabel,
  driverOrder,
  listDrivers,
  loadTransportBoard,
  movePassenger,
  moveTargets,
  nextStatus,
  passengerTimeHint,
  resetPassenger,
  setJobDriver,
  setJobStatus,
  splitByDirection,
  subscribeTransport,
  summarize,
  TRANSPORT_STATUS_LABEL,
  TRANSPORT_TYPE_LABEL,
  waitAfterLanding,
  type Driver,
  type TransportDirection,
  type TransportJob,
  type TransportPassenger,
} from '../lib/transport'
import { PARKING_TYPE_LABEL } from '../types/domain'

type Mode = 'dispo' | 'fahrer'

const STATUS_STYLE: Record<TransportJob['status'], string> = {
  planned: 'bg-chip text-subtle',
  assigned: 'bg-accent-soft text-accent-dark',
  underway: 'bg-accent text-white',
  done: 'bg-ok-soft text-ok-ink',
  cancelled: 'bg-danger-soft text-danger-ink',
}

function dayLabel(offset: number, from: string): string {
  if (offset === 0) return `Heute, ${formatDate(from)}`
  if (offset === 1) return `Morgen, ${formatDate(from)}`
  if (offset === -1) return `Gestern, ${formatDate(from)}`
  const weekday = new Date(from).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' })
  return `${weekday}, ${formatDate(from)}`
}

function DayBar({ offset, onChange, label }: { offset: number; onChange: (n: number) => void; label: string }) {
  const chip = (active: boolean) =>
    `touch-target rounded-full px-4 text-sm font-semibold ${active ? 'bg-ink text-white' : 'bg-chip text-subtle hover:bg-line'}`
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1.5" role="group" aria-label="Tag">
        <button type="button" className={chip(offset === 0)} aria-pressed={offset === 0} onClick={() => onChange(0)}>Heute</button>
        <button type="button" className={chip(offset === 1)} aria-pressed={offset === 1} onClick={() => onChange(1)}>Morgen</button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className="touch-target flex size-11 items-center justify-center rounded-full bg-chip text-lg hover:bg-line"
          aria-label="Vorheriger Tag" onClick={() => onChange(offset - 1)}>‹</button>
        <span className="min-w-40 px-2 text-center text-sm font-medium tabular-nums">{label}</span>
        <button type="button" className="touch-target flex size-11 items-center justify-center rounded-full bg-chip text-lg hover:bg-line"
          aria-label="Nächster Tag" onClick={() => onChange(offset + 1)}>›</button>
      </div>
    </div>
  )
}

function CapacityBar({ job }: { job: TransportJob }) {
  const state = capacityState(job)
  const pct = Math.min(100, job.capacity ? (job.persons / job.capacity) * 100 : 0)
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-chip">
        <div className={`h-full ${state === 'over' ? 'bg-danger' : state === 'full' ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono tabular-nums ${state === 'over' ? 'font-bold text-danger' : ''}`}>
        {job.persons}/{job.capacity}
      </span>
      {state === 'over' && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger-ink">überbucht</span>}
    </div>
  )
}

function PassengerRow({ job, p, onMove, onReset, compact }: {
  job: TransportJob
  p: TransportPassenger
  onMove?: (p: TransportPassenger) => void
  onReset?: (p: TransportPassenger) => void
  compact?: boolean
}) {
  const wait = waitAfterLanding(job, p)
  const cancelled = p.booking_status === 'cancelled'
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-sm ${cancelled ? 'opacity-50 line-through' : ''}`}>
      <Link to={`/fahrzeuge/${p.booking_id}`} className="font-mono font-semibold text-accent underline-offset-2 hover:underline">
        {p.plate}
      </Link>
      <span className="inline-flex items-center gap-1 rounded-full bg-chip px-2 py-0.5 text-xs font-semibold">
        {p.persons} {p.persons === 1 ? 'Person' : 'Personen'}
      </span>
      {p.flight && <span className="font-mono text-xs">{p.flight}</span>}
      {p.terminal && <span className="rounded-md bg-ink px-1.5 py-0.5 text-xs font-bold text-white">{p.terminal}</span>}
      <span className="text-xs text-subtle">{passengerTimeHint(job, p)}</span>
      {wait != null && wait > 45 && <span className="text-xs text-warn-ink">wartet {wait} min</span>}
      {!compact && <span className="min-w-0 flex-1 truncate text-subtle">{p.customer_name}</span>}
      {compact && <span className="flex-1" />}
      {p.customer_phone && (
        <a href={`tel:${p.customer_phone.replace(/\s/g, '')}`} className="touch-target inline-flex items-center rounded-lg bg-chip px-3 text-xs font-semibold">
          Anrufen
        </a>
      )}
      {!compact && p.parking_type === 'indoor' && <span className="text-xs text-subtle">{PARKING_TYPE_LABEL.indoor}</span>}
      {p.manual && !compact && (
        <button type="button" onClick={() => onReset?.(p)} className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink"
          title="Von der Dispo umgesetzt – tippen, um wieder automatisch zu planen">
          von Hand ↺
        </button>
      )}
      {onMove && (job.status === 'planned' || job.status === 'assigned') && (
        <button type="button" onClick={() => onMove(p)} className="touch-target rounded-lg border border-line-strong px-3 text-xs font-semibold hover:bg-ground">
          {isValet(job) ? 'Zeit ändern' : 'Umsetzen'}
        </button>
      )}
    </li>
  )
}

function JobCard({ job, drivers, busy, onStatus, onDriver, onMove, onReset }: {
  job: TransportJob
  drivers: Driver[]
  busy: boolean
  onStatus: (job: TransportJob) => void
  onDriver: (job: TransportJob, driverId: string | null) => void
  onMove: (job: TransportJob, p: TransportPassenger) => void
  onReset: (p: TransportPassenger) => void
}) {
  const next = nextStatus(job.status)
  const over = capacityState(job) === 'over'
  return (
    <article className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${over ? 'border-danger/50' : 'border-line'} ${job.status === 'done' ? 'opacity-60' : ''}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <span className="font-mono text-xl font-bold tabular-nums">{formatTime(job.scheduled_at)}</span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${job.type === 'premium_on_demand' ? 'bg-warn-soft text-warn-ink' : 'bg-accent-soft text-accent-dark'}`}>
          {TRANSPORT_TYPE_LABEL[job.type]}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[job.status]}`}>{TRANSPORT_STATUS_LABEL[job.status]}</span>
        {isValet(job) ? (
          <span className="text-sm font-semibold">
            {tripLabel(job)}{meetingTerminal(job) ? ` ${meetingTerminal(job)}` : ''}
          </span>
        ) : (
          <CapacityBar job={job} />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select aria-label="Fahrer" value={job.driver_id ?? ''} disabled={busy || job.status === 'done'}
            onChange={(e) => onDriver(job, e.target.value || null)} className="w-auto min-w-36">
            <option value="">Fahrer wählen</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.display_name}</option>)}
            {job.driver_id && !drivers.some((d) => d.id === job.driver_id) && (
              <option value={job.driver_id}>{job.driver_name ?? 'Fahrer'}</option>
            )}
          </Select>
          {next && <Button variant="primary" disabled={busy} onClick={() => onStatus(job)}>{next.label}</Button>}
        </div>
      </header>
      {job.note && <p className="border-t border-line bg-ground px-3 py-1.5 text-xs text-subtle">{job.note}</p>}
      {driverShuttleHint(job) && <p className="border-t border-line bg-ground px-3 py-1.5 text-xs text-subtle">{driverShuttleHint(job)}</p>}
      <ul>
        {job.passengers.map((p) => (
          <PassengerRow key={p.id} job={job} p={p} onMove={(x) => onMove(job, x)} onReset={onReset} />
        ))}
      </ul>
    </article>
  )
}

/** Fahreransicht: nur Zeit, Route, Kennzeichen, Personen und der nächste Schritt */
function DriverCard({ job, busy, onStatus }: { job: TransportJob; busy: boolean; onStatus: (job: TransportJob) => void }) {
  const next = nextStatus(job.status)
  return (
    <article className={`overflow-hidden rounded-2xl border border-line bg-white shadow-sm ${job.status === 'done' ? 'opacity-60' : ''}`}>
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="font-mono text-3xl font-bold tabular-nums">{formatTime(job.scheduled_at)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">
            {routeLabel(job)}{isValet(job) && meetingTerminal(job) ? ` · ${meetingTerminal(job)}` : ''}
          </span>
          <span className="text-sm text-subtle">
            {job.persons} {job.persons === 1 ? 'Person' : 'Personen'} · {TRANSPORT_TYPE_LABEL[job.type]}
            {job.driver_name ? ` · ${job.driver_name}` : ''}
          </span>
        </span>
        {next ? (
          <Button variant="primary" disabled={busy} onClick={() => onStatus(job)} className="min-w-28">{next.label}</Button>
        ) : (
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[job.status]}`}>{TRANSPORT_STATUS_LABEL[job.status]}</span>
        )}
      </header>
      {driverShuttleHint(job) && <p className="border-t border-line bg-ground px-4 py-1.5 text-sm">{driverShuttleHint(job)}</p>}
      <ul>
        {job.passengers.map((p) => <PassengerRow key={p.id} job={job} p={p} compact />)}
      </ul>
    </article>
  )
}

function MoveDialog({ job, passenger, jobs, onClose, onDone }: {
  job: TransportJob
  passenger: TransportPassenger
  jobs: TransportJob[]
  onClose: () => void
  onDone: () => void
}) {
  const targets = moveTargets(jobs, job)
  const valet = isValet(job)
  const [time, setTime] = useState(formatTime(job.scheduled_at))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(target: { jobId: string } | { at: string }) {
    setBusy(true)
    setError(null)
    try {
      await movePassenger(passenger.id, target)
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  function onDemand() {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
    if (!m) return setError('Uhrzeit als HH:MM eingeben')
    // gleicher Berlin-Tag wie die aktuelle Fahrt
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(job.scheduled_at))
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${day}T12:00:00Z`)).find((x) => x.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00'
    void run({ at: `${day}T${m[1].padStart(2, '0')}:${m[2]}:00${offset}` })
  }

  return (
    <Dialog title={`${passenger.plate} ${valet ? '– Uhrzeit ändern' : 'umsetzen'}`} onClose={onClose}>
      <p className="mb-3 text-sm text-subtle">
        {tripLabel(job)} · bisher {formatTime(job.scheduled_at)} · {passenger.persons} {passenger.persons === 1 ? 'Person' : 'Personen'}.
        {valet ? ' Eine von Hand geänderte Zeit plant die App nicht mehr automatisch um.' : ' Umgesetzte Fahrgäste plant die App nicht mehr automatisch um.'}
      </p>
      {error && <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p>}
      {!valet && <h3 className="mb-2 text-sm font-semibold">In bestehende Fahrt</h3>}
      {valet ? null : targets.length === 0 ? (
        <p className="mb-4 text-sm text-muted">Keine andere offene Fahrt in diese Richtung an diesem Tag.</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {targets.map((t) => {
            const after = t.persons + passenger.persons
            return (
              <li key={t.id}>
                <button type="button" disabled={busy} onClick={() => void run({ jobId: t.id })}
                  className="touch-target flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left text-sm hover:bg-ground">
                  <span className="font-mono font-bold">{formatTime(t.scheduled_at)}</span>
                  <span>{TRANSPORT_TYPE_LABEL[t.type]}</span>
                  <span className={`ml-auto font-mono ${after > t.capacity ? 'font-bold text-danger' : 'text-subtle'}`}>
                    danach {after}/{t.capacity}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {!valet && <h3 className="mb-2 text-sm font-semibold">Neue Fahrt auf Abruf</h3>}
      <div className="flex items-end gap-2">
        <Field label="Uhrzeit" className="w-32">
          <TextInput inputMode="numeric" value={time} onChange={(e) => setTime(e.target.value)} placeholder="HH:MM" />
        </Field>
        <Button variant="primary" disabled={busy} onClick={onDemand}>{valet ? 'Übernehmen' : 'Anlegen'}</Button>
      </div>
    </Dialog>
  )
}

function Column({ direction, jobs, children }: { direction: TransportDirection; jobs: TransportJob[]; children: ReactNode }) {
  const persons = jobs.reduce((s, j) => s + j.persons, 0)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{DIRECTION_LABEL[direction]}</h2>
        <span className="text-xs text-muted">{jobs.length} Fahrten · {persons} Personen</span>
      </div>
      {jobs.length === 0 ? <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-sm text-muted">Keine Fahrten.</p> : children}
    </section>
  )
}

export function ShuttlePage() {
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('ansicht') === 'fahrer' ? 'fahrer' : 'dispo'
  const offset = Number(params.get('tag') ?? 0) || 0
  const { profile } = useAuth()
  const [onlyMine, setOnlyMine] = useState(false)
  const [jobs, setJobs] = useState<TransportJob[] | null>(null)
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState<{ job: TransportJob; p: TransportPassenger } | null>(null)

  const range = useMemo(() => dayRange(offset), [offset])

  const reload = useCallback(() => {
    loadTransportBoard(range.from, range.to)
      .then((d) => {
        setJobs(d)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [range])

  useEffect(() => {
    reload()
    const off = subscribeTransport(reload)
    const timer = setInterval(reload, 60_000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [reload])

  useEffect(() => {
    listDrivers().then(setDrivers).catch(() => setDrivers([]))
  }, [])

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Losfahren ohne eingeteilten Fahrer: wer losfährt, wird Fahrer */
  function advance(job: TransportJob) {
    const n = nextStatus(job.status)
    if (!n) return
    void act(() => setJobStatus(job.id, n.to, n.to === 'underway' && !job.driver_id ? profile?.id ?? null : null))
  }

  const visible = (jobs ?? []).filter((j) => j.passengers.length > 0 && j.status !== 'cancelled')
  const split = splitByDirection(visible)
  const sum = summarize(visible)

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Shuttle</h1>
          <div className="flex gap-1.5" role="group" aria-label="Ansicht">
            {(['dispo', 'fahrer'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => update({ ansicht: m === 'dispo' ? null : m })}
                className={`touch-target rounded-full px-4 text-sm font-semibold ${mode === m ? 'bg-ink text-white' : 'bg-chip text-subtle hover:bg-line'}`}>
                {m === 'dispo' ? 'Dispo' : 'Fahrer'}
              </button>
            ))}
          </div>
        </div>
        <DayBar offset={offset} onChange={(n) => update({ tag: n === 0 ? null : String(n) })} label={dayLabel(offset, range.from)} />
      </header>

      {error && <p className="rounded-xl bg-danger-soft px-4 py-2 text-sm text-danger-ink">{error}</p>}
      {!jobs && !error && <p className="text-sm text-muted">Lädt …</p>}

      {jobs && mode === 'dispo' && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-chip px-3 py-1">{sum.trips} Fahrten · {sum.persons} Personen</span>
            {sum.unassigned > 0 && <span className="rounded-full bg-warn-soft px-3 py-1 text-warn-ink">{sum.unassigned} ohne Fahrer</span>}
            {sum.over > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-3 py-1 font-semibold text-danger-ink">
                <Icon name="warning" className="size-4" /> {sum.over} überbucht
              </span>
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {(['to_airport', 'from_airport'] as const).map((dir) => (
              <Column key={dir} direction={dir} jobs={split[dir]}>
                {split[dir].map((j) => (
                  <JobCard key={j.id} job={j} drivers={drivers} busy={busy}
                    onStatus={advance}
                    onDriver={(x, d) => void act(() => setJobDriver(x, d))}
                    onMove={(x, p) => setMoving({ job: x, p })}
                    onReset={(p) => void act(() => resetPassenger(p.id))} />
                ))}
              </Column>
            ))}
          </div>
          <p className="text-xs text-muted">
            Fahrten entstehen automatisch aus Buchungen mit Shuttle: Hinfahrt im nächsten Slot nach Ankunft am Platz,
            Rückfahrt im nächsten Slot nach der Landung. Halle und Zeiten außerhalb der Betriebszeiten werden Fahrten auf Abruf.
            Hol- & Bringservice: Übernahme am Terminal zur Ankunftszeit, Rückgabe am Terminal 30 min nach der Landung;
            Terminal aus der Flugnummer, der Fahrer fährt mit dem Shuttle hin bzw. zurück.
          </p>
        </>
      )}

      {jobs && mode === 'fahrer' && (
        <>
          {profile && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              Nur meine Fahrten
            </label>
          )}
          {driverOrder(visible, onlyMine ? profile?.id : null).length === 0 ? (
            <p className="text-sm text-muted">Keine Fahrten.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {driverOrder(visible, onlyMine ? profile?.id : null).map((j) => (
                <DriverCard key={j.id} job={j} busy={busy}
                  onStatus={advance} />
              ))}
            </div>
          )}
        </>
      )}

      {moving && (
        <MoveDialog job={moving.job} passenger={moving.p} jobs={jobs ?? []}
          onClose={() => setMoving(null)}
          onDone={() => { setMoving(null); reload() }} />
      )}
    </div>
  )
}
