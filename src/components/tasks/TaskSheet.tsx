import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatDateTime } from '../../lib/format'
import { uploadQueue, usePendingMedia } from '../../lib/media/mediaService'
import { getBoardTask, listTaskPhotos, taskKindLabel, toggleChecklistItem, updateTask, type BoardTask } from '../../lib/tasks'
import type { Media } from '../../types/domain'
import { MediaThumb, PendingThumb } from '../media/MediaThumb'
import { PhotoCapture } from '../media/PhotoCapture'
import { Button, Dialog, ErrorList } from '../ui'

/** Aufgabe bearbeiten: Teilschritte, Fotos, Notiz, Status. */
export function TaskSheet({ taskId, onClose, onChanged }: { taskId: string; onClose: () => void; onChanged: () => void }) {
  const [task, setTask] = useState<BoardTask | null>(null)
  const [photos, setPhotos] = useState<Media[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = usePendingMedia('task', taskId)

  const load = useCallback(async () => {
    try {
      const t = await getBoardTask(taskId)
      setTask(t)
      setNote(t.note ?? '')
      setPhotos(await listTaskPhotos(taskId))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [taskId])

  useEffect(() => {
    void load()
    // Nach abgeschlossenem Upload Fotoliste aktualisieren
    const unsubscribe = uploadQueue.onUploaded((e) => {
      if (e.ownerId === taskId) void listTaskPhotos(taskId).then(setPhotos)
    })
    return () => void unsubscribe()
  }, [load, taskId])

  async function run(action: () => Promise<unknown>, { close = false } = {}) {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (close) {
        onChanged()
        onClose()
        return
      }
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!task) {
    return (
      <Dialog title="Aufgabe" onClose={onClose}>
        {error ? <ErrorList errors={[error]} /> : <p className="text-sm text-muted">Lädt …</p>}
      </Dialog>
    )
  }

  const steps = task.checklist ?? []
  const allStepsDone = steps.every((s) => s.done)
  const isRelocate = task.type === 'relocate'

  return (
    <Dialog
      title={task.title ?? taskKindLabel(task)}
      onClose={onClose}
      footer={
        <>
          {task.status === 'open' && (
            <Button variant="primary" disabled={busy} onClick={() => void run(() => updateTask(task.id, { status: 'in_progress' }))}>
              Starten
            </Button>
          )}
          {task.status === 'in_progress' && (
            <>
              <Button disabled={busy} onClick={() => void run(() => updateTask(task.id, { status: 'open' }))}>Zurück auf offen</Button>
              <Button variant="primary" disabled={busy} onClick={() => void run(() => updateTask(task.id, { status: 'done' }), { close: true })}>
                Erledigt
              </Button>
            </>
          )}
          {task.status === 'done' && (
            <Button disabled={busy} onClick={() => void run(() => updateTask(task.id, { status: 'in_progress' }))}>Wieder öffnen</Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span>
            <span className="font-mono text-base font-semibold">{task.plate}</span>
            <span className="text-subtle"> · {task.vehicle_model ?? ''}{task.location_code ? ` · ${task.location_code}` : ''}</span>
          </span>
          <Link to={`/fahrzeuge/${task.booking_id}`} className="text-accent underline">Zum Fahrzeug</Link>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-subtle">Art</dt><dd>{taskKindLabel(task)}</dd></div>
          <div><dt className="text-xs text-subtle">Fällig</dt><dd>{task.due_at ? formatDateTime(task.due_at) : '–'}</dd></div>
          <div>
            <dt className="text-xs text-subtle">Status</dt>
            <dd>
              {task.status === 'done'
                ? `erledigt ${task.done_by_name ? `von ${task.done_by_name}` : ''}`
                : task.status === 'in_progress'
                  ? `in Arbeit ${task.started_by_name ? `(${task.started_by_name})` : ''}`
                  : 'offen'}
            </dd>
          </div>
        </dl>

        {isRelocate && (
          <div className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">
            {task.note}
            {task.location_code && (
              <Link to={`/lageplan?platz=${encodeURIComponent(task.location_code)}`} className="ml-2 underline">Im Lageplan</Link>
            )}
          </div>
        )}

        {steps.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Teilschritte {steps.filter((s) => s.done).length}/{steps.length}</h3>
            <ul className="flex flex-col gap-1.5">
              {steps.map((s, i) => (
                <li key={i}>
                  <label className="touch-target flex cursor-pointer items-center gap-3 rounded-lg bg-ground px-3 py-2">
                    <input type="checkbox" checked={s.done} disabled={busy || task.status === 'done'} className="size-5 accent-accent"
                      onChange={() => void run(() => toggleChecklistItem(task, i))} />
                    <span className={s.done ? 'text-muted line-through' : ''}>{s.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            {task.status === 'in_progress' && allStepsDone && (
              <p className="mt-2 text-sm text-ok">Alle Teilschritte erledigt – Aufgabe abschließen?</p>
            )}
          </section>
        )}

        {!isRelocate && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Fotos</h3>
            <div className="flex flex-wrap gap-2">
              {photos.map((m) => <MediaThumb key={m.id} media={m} alt={`Foto ${task.title}`} />)}
              {pending.map((p) => <PendingThumb key={p.id} item={p} />)}
            </div>
            <div className="mt-2">
              <PhotoCapture owner={{ bookingId: task.booking_id, ownerType: 'task', ownerId: task.id }} />
            </div>
          </section>
        )}

        {!isRelocate && (
          <section>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Notiz
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                onBlur={() => note !== (task.note ?? '') && void run(() => updateTask(task.id, { note: note.trim() || null }))}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base font-normal md:text-sm" />
            </label>
          </section>
        )}
        <ErrorList errors={error ? [error] : []} />
      </div>
    </Dialog>
  )
}
