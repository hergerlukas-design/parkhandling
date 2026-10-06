import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { formatDate, formatTime } from '../lib/format'
import { subscribeBoard } from '../lib/siteplan'
import { subscribeTasks } from '../lib/tasks'
import { loadToday, type DayEvent, type EventState, type TodayData } from '../lib/today'

const STATE_STYLE: Record<EventState, { badge: string; dot: string; row: string }> = {
  done: { badge: 'bg-chip text-subtle', dot: 'bg-muted', row: 'opacity-60' },
  ready: { badge: 'bg-ok-soft text-ok-ink', dot: 'bg-ok', row: '' },
  open: { badge: 'bg-warn-soft text-warn-ink', dot: 'bg-warn', row: 'bg-warn-soft/40' },
  expected: { badge: 'bg-accent-soft text-accent-dark', dot: 'bg-accent', row: '' },
  overdue: { badge: 'bg-danger-soft text-danger-ink', dot: 'bg-danger', row: '' },
}

function Kpi({ label, value, sub, to, alert }: { label: string; value: number; sub: string; to: string; alert?: boolean }) {
  return (
    <Link to={to}
      className={`flex flex-col gap-0.5 rounded-2xl border bg-white p-4 shadow-sm hover:bg-ground ${alert ? 'border-danger/40' : 'border-line'}`}>
      <span className="text-sm text-subtle">{label}</span>
      <span className={`text-3xl font-bold tabular-nums ${alert ? 'text-danger' : ''}`}>{value}</span>
      <span className="hidden text-xs text-muted sm:block">{sub}</span>
    </Link>
  )
}

function KindBadge({ kind }: { kind: DayEvent['kind'] }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${kind === 'in' ? 'bg-accent-soft text-accent-dark' : 'bg-ink text-white'}`}>
      {kind === 'in' ? 'Ankunft' : 'Abholung'}
    </span>
  )
}

function EventRow({ e }: { e: DayEvent }) {
  const st = STATE_STYLE[e.state]
  return (
    <li>
      <Link to={`/fahrzeuge/${e.bookingId}`}
        className={`touch-target flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-ground ${st.row}`}>
        <span className="w-12 shrink-0 font-mono text-sm font-semibold tabular-nums">{formatTime(e.at)}</span>
        <span className={`size-2.5 shrink-0 rounded-full md:hidden ${st.dot}`} aria-hidden="true" />
        <span className="hidden w-20 shrink-0 md:block"><KindBadge kind={e.kind} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            <span className="font-mono font-semibold">{e.plate}</span>
            {e.model && <span className="hidden text-subtle sm:inline"> · {e.model}</span>}
            <span className="ml-1 text-xs text-muted md:hidden">{e.kind === 'in' ? '↓ Ankunft' : '↑ Abholung'}</span>
          </span>
          <span className="block truncate text-xs text-subtle">{e.info}</span>
        </span>
        {e.unpaid && <span className="hidden rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger-ink sm:inline">Zahlung offen</span>}
        <span className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold md:inline ${st.badge}`}>{e.stateLabel}</span>
      </Link>
    </li>
  )
}

export function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const reload = useCallback(() => {
    setNow(new Date())
    loadToday()
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
    const offBoard = subscribeBoard(reload)
    const offTasks = subscribeTasks(reload)
    const timer = setInterval(reload, 60_000)
    return () => {
      offBoard()
      offTasks()
      clearInterval(timer)
    }
  }, [reload])

  const weekday = now.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' })

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Heute</h1>
        <span className="text-sm text-subtle">{weekday}, {formatDate(now)} · {formatTime(now)}</span>
      </header>

      {error && <p className="rounded-xl bg-danger-soft px-4 py-2 text-sm text-danger-ink">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Lädt …</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Ankünfte heute" value={data.kpis.arrivals} sub={`davon ${data.kpis.arrivalsHall} Halle`} to="/einchecken" />
            <Kpi label="Abholungen heute" value={data.kpis.pickups} sub={`${data.kpis.pickupsHall} aus der Halle`} to="/fahrzeuge?filter=pickup_today" />
            <Kpi label="Offene Aufgaben" value={data.kpis.openTasks} sub={`${data.kpis.dueToday} fällig heute`} to="/aufgaben" />
            <Kpi label="Umsetzen nötig" value={data.kpis.relocate} sub={data.kpis.relocateText} to="/aufgaben?filter=relocate" alert={data.kpis.relocate > 0} />
          </div>

          {/* Smartphone: wichtigster Hinweis oben */}
          {data.alerts[0] && (
            <Link to={data.alerts[0].href}
              className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm lg:hidden ${data.alerts[0].tone === 'danger' ? 'bg-danger-soft text-danger-ink' : 'bg-warn-soft text-warn-ink'}`}>
              <Icon name="warning" className="mt-0.5 size-4 shrink-0" />
              <span><strong>{data.alerts[0].title}</strong> {data.alerts[0].text}</span>
            </Link>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
              <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <h2 className="font-semibold">Ablauf heute</h2>
                <span className="hidden text-xs text-muted sm:inline">Ankünfte und Abholungen nach Uhrzeit</span>
              </div>
              {data.events.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">Heute keine Ankünfte oder Abholungen.</p>
              ) : (
                <ul>
                  {data.events.map((e) => <EventRow key={`${e.kind}-${e.bookingId}`} e={e} />)}
                </ul>
              )}
            </section>

            <div className="flex flex-col gap-4">
              <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
                <h2 className="mb-3 font-semibold">Braucht Aufmerksamkeit</h2>
                {data.alerts.length === 0 ? (
                  <p className="text-sm text-muted">Alles im grünen Bereich.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {data.alerts.slice(0, 8).map((a, i) => (
                      <li key={i}>
                        <Link to={a.href}
                          className={`block rounded-xl px-3 py-2.5 text-sm ${a.tone === 'danger' ? 'bg-danger-soft text-danger-ink' : 'bg-warn-soft text-warn-ink'}`}>
                          <strong className="block">{a.title}</strong>
                          {a.text}
                        </Link>
                      </li>
                    ))}
                    {data.alerts.length > 8 && <li className="text-xs text-muted">+ {data.alerts.length - 8} weitere</li>}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
                <h2 className="mb-3 font-semibold">Belegung</h2>
                <ul className="flex flex-col gap-3">
                  {data.capacity.map((c) => (
                    <li key={c.label} className="text-sm">
                      <div className="mb-1 flex justify-between">
                        <span>{c.label}</span>
                        <span className="font-mono">{c.used} / {c.total}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-chip">
                        <div className={`h-full ${c.total && c.used / c.total > 0.9 ? 'bg-danger' : 'bg-accent'}`}
                          style={{ width: `${c.total ? (c.used / c.total) * 100 : 0}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
                <Link to="/lageplan" className="mt-3 inline-block text-sm text-accent underline">Zum Lageplan</Link>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
