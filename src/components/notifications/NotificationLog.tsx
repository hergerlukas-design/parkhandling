import { useCallback, useEffect, useState } from 'react'
import { formatDateTime } from '../../lib/format'
import { PUSH_EVENT_LABEL, type PushEvent } from '../../lib/push/events'
import { NOTIFICATION_PAGE_SIZE, notificationPage, pageCount, type NotificationLogEntry } from '../../lib/push/pushClient'
import { Button, ErrorList } from '../ui'

const STATUS_LABEL: Record<NotificationLogEntry['status'], { text: string; className: string }> = {
  pending: { text: 'wartet', className: 'bg-chip text-subtle' },
  sending: { text: 'wird gesendet', className: 'bg-accent-soft text-accent-dark' },
  sent: { text: 'gesendet', className: 'bg-ok-soft text-ok-ink' },
  failed: { text: 'fehlgeschlagen', className: 'bg-danger-soft text-danger-ink' },
  skipped: { text: 'kein Empfänger', className: 'bg-chip text-muted' },
}

function eventLabel(event: string): string {
  return event === 'test' ? 'Test' : (PUSH_EVENT_LABEL[event as PushEvent]?.title ?? event)
}

/** Admin: Protokoll der Benachrichtigungen, neueste zuerst, 10 je Seite */
export function NotificationLog() {
  const [page, setPage] = useState(0)
  const [entries, setEntries] = useState<NotificationLogEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (p: number) => {
    setBusy(true)
    try {
      const res = await notificationPage(p)
      // Seite gibt es nicht mehr (z. B. Einträge gelöscht): letzte vorhandene zeigen
      const last = pageCount(res.total) - 1
      if (p > last) {
        setPage(last)
        return
      }
      setEntries(res.entries)
      setTotal(res.total)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(page)
  }, [page, load])

  const pages = pageCount(total)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{total} insgesamt</p>
        <Button onClick={() => void load(page)} disabled={busy}>Aktualisieren</Button>
      </div>
      <ErrorList errors={error ? [error] : []} />
      {entries == null ? (
        <p className="text-sm text-muted">Lädt …</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">Noch keine Benachrichtigungen.</p>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{n.payload.title ?? eventLabel(n.event)}</p>
                <p className="truncate text-xs text-muted">
                  {formatDateTime(n.created_at)} · {eventLabel(n.event)}
                  {n.sent_count > 0 ? ` · ${n.sent_count} Gerät${n.sent_count === 1 ? '' : 'e'}` : ''}
                  {n.error ? ` · ${n.error}` : ''}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_LABEL[n.status].className}`}>
                {STATUS_LABEL[n.status].text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Seiten" className="flex items-center justify-between gap-2">
          <Button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={busy || page === 0}>‹ Neuere</Button>
          <span className="text-sm text-subtle">Seite {page + 1} von {pages}</span>
          <Button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={busy || page >= pages - 1}>Ältere ›</Button>
        </nav>
      )}
      <p className="text-xs text-muted">{NOTIFICATION_PAGE_SIZE} Einträge je Seite, neueste zuerst.</p>
    </div>
  )
}
