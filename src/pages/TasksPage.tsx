import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { TaskCard } from '../components/tasks/TaskCard'
import { TaskSheet } from '../components/tasks/TaskSheet'
import { berlinDayStart } from '../lib/bookings'
import { loadTaskBoard, matchesFilter, subscribeTasks, TASK_FILTERS, type BoardTask, type TaskFilter } from '../lib/tasks'

type Column = 'open' | 'in_progress' | 'done'
const COLUMNS: [Column, string][] = [
  ['open', 'Offen'],
  ['in_progress', 'In Arbeit'],
  ['done', 'Erledigt heute'],
]

export function TasksPage() {
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [mobileColumn, setMobileColumn] = useState<Column>('open')
  const [error, setError] = useState<string | null>(null)
  const openId = params.get('aufgabe')

  const reload = useCallback(() => {
    loadTaskBoard().then(setTasks).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
    return subscribeTasks(reload)
  }, [reload])

  const endOfToday = berlinDayStart(1)
  const filtered = useMemo(() => tasks.filter((t) => matchesFilter(t, filter, endOfToday)), [tasks, filter, endOfToday])
  const byColumn = (c: Column) => filtered.filter((t) => t.status === c)

  const open = (t: BoardTask) => setParams({ aufgabe: t.id })
  const close = () => setParams({}, { replace: true })

  return (
    <div className="mx-auto flex h-full max-w-screen-2xl flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {TASK_FILTERS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilter(value)}
              className={`touch-target shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap ${
                filter === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <span className="hidden text-sm text-subtle md:inline">Sortiert nach Fälligkeit</span>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Smartphone: Tabs statt Spalten */}
      <div className="inline-flex rounded-xl bg-chip p-1 md:hidden" role="tablist">
        {COLUMNS.map(([c, label]) => (
          <button key={c} type="button" role="tab" aria-selected={mobileColumn === c} onClick={() => setMobileColumn(c)}
            className={`touch-target flex-1 rounded-lg px-2 py-2 text-sm font-semibold ${mobileColumn === c ? 'bg-surface shadow-sm' : 'text-subtle'}`}>
            {label.replace(' heute', '')} {byColumn(c).length}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-3">
        {COLUMNS.map(([c, label]) => (
          <section key={c} className={`flex min-h-0 flex-col rounded-2xl bg-chip/70 p-3 ${mobileColumn === c ? '' : 'hidden md:flex'}`}>
            <header className="mb-2 hidden items-baseline justify-between px-1 md:flex">
              <h2 className="font-semibold">{label}</h2>
              <span className="text-sm text-subtle">{byColumn(c).length}</span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {byColumn(c).map((t) => <TaskCard key={t.id} task={t} onOpen={open} />)}
              {byColumn(c).length === 0 && <p className="px-1 py-4 text-center text-sm text-muted">Keine Aufgaben</p>}
            </div>
          </section>
        ))}
      </div>

      {openId && <TaskSheet taskId={openId} onClose={close} onChanged={reload} />}
    </div>
  )
}
