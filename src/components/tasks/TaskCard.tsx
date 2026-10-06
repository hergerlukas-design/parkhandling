import { daysUntil } from '../../lib/due'
import { formatDate, formatTime } from '../../lib/format'
import { taskKind, taskKindLabel, type BoardTask } from '../../lib/tasks'

const CHIP: Record<ReturnType<typeof taskKind>, string> = {
  care: 'bg-accent-soft text-due-week-ink',
  charge_fuel: 'bg-ok-soft text-ok-ink',
  relocate: 'bg-danger-soft text-danger-ink',
  service: 'bg-chip text-subtle',
}

function dueText(t: BoardTask): { text: string; urgent: boolean } {
  if (t.status === 'done') return { text: t.done_at ? formatTime(t.done_at) : '', urgent: false }
  if (!t.due_at) return { text: '', urgent: false }
  const d = daysUntil(t.due_at)
  if (d <= 0) return { text: `bis ${d < 0 ? formatDate(t.due_at).slice(0, 6) : formatTime(t.due_at)}`, urgent: true }
  return { text: `bis ${formatDate(t.due_at).slice(0, 6)}`, urgent: false }
}

/** Aufgabenkarte wie im Klick-Prototyp. */
export function TaskCard({ task, onOpen }: { task: BoardTask; onOpen: (t: BoardTask) => void }) {
  const kind = taskKind(task)
  const due = dueText(task)
  const steps = task.checklist ?? []
  const stepsDone = steps.filter((s) => s.done).length
  const right =
    task.status === 'done'
      ? task.photo_count > 0
        ? `${task.photo_count} Foto${task.photo_count === 1 ? '' : 's'}`
        : (task.done_by_name ?? '')
      : task.status === 'in_progress'
        ? (task.started_by_name ?? '')
        : kind === 'relocate'
          ? (task.note?.match(/^\d+ Umsetzvorgänge/)?.[0].replace('Umsetzvorgänge', 'Bewegungen') ?? '')
          : steps.length
            ? `${stepsDone}/${steps.length} Schritte`
            : ''
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={`flex w-full flex-col gap-1 rounded-xl border bg-surface p-3 text-left shadow-sm transition hover:shadow ${
        kind === 'relocate' && task.status !== 'done' ? 'border-danger/40' : 'border-transparent'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${CHIP[kind]}`}>{taskKindLabel(task)}</span>
        <span className={`text-sm font-semibold ${due.urgent ? 'text-danger' : ''}`}>{due.text}</span>
      </span>
      <span className="font-semibold">{task.title}</span>
      <span className="flex items-center justify-between gap-2 text-sm text-subtle">
        <span className="truncate">
          <span className="font-mono text-ink">{task.plate}</span>
          {task.location_code && ` · ${task.location_code}`}
        </span>
        <span className="shrink-0 text-xs">{right}</span>
      </span>
    </button>
  )
}
