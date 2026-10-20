import { useEffect, useState } from 'react'
import { formatDateTime } from '../../lib/format'
import { clearClientErrors, listClientErrors, type ClientErrorRow } from '../../lib/errorReporting'
import { Button, ErrorList } from '../ui'

const KIND_LABEL: Record<ClientErrorRow['kind'], string> = {
  error: 'Fehler',
  unhandledrejection: 'Fehler (async)',
  react: 'Absturz Ansicht',
  manual: 'Meldung',
}

/** Fehler aus der App der letzten 90 Tage (nur Admins); gleiche Fehler sind zusammengefasst. */
export function ClientErrorsSettings() {
  const [rows, setRows] = useState<ClientErrorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  async function reload() {
    try {
      setRows(await listClientErrors())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => void reload(), [])

  async function clearAll() {
    if (!rows) return
    try {
      await clearClientErrors(rows.map((r) => r.id))
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!rows) return error ? <ErrorList errors={[error]} /> : <p className="text-sm text-muted">Lädt …</p>

  return (
    <div className="flex flex-col gap-3 text-sm">
      <ErrorList errors={error ? [error] : []} />
      {rows.length === 0 ? (
        <p className="text-subtle">Keine Fehler gemeldet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 text-left"
                aria-expanded={open === r.id}
                onClick={() => setOpen(open === r.id ? null : r.id)}
              >
                <span className="font-medium break-words">{r.message}</span>
                <span className="text-xs text-muted">
                  {formatDateTime(r.last_seen_at)} · {KIND_LABEL[r.kind]}
                  {r.occurrences > 1 && ` · ${r.occurrences}×`} · {r.profile?.display_name || 'unbekannt'} ·{' '}
                  {r.route ?? '–'} · v{r.app_version ?? '?'}
                </span>
              </button>
              {open === r.id && (
                <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-chip p-2 text-xs whitespace-pre-wrap">
                  {r.stack ?? 'Kein Stacktrace'}
                  {r.user_agent && `\n\n${r.user_agent}`}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void reload()}>Aktualisieren</Button>
        {rows.length > 0 && <Button onClick={() => void clearAll()}>Angezeigte als erledigt löschen</Button>}
      </div>
    </div>
  )
}
