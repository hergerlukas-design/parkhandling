import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { IMPORT_FLAG_LABEL, MAIL_TYPE_LABEL } from '../../booking-adapters'
import { formatDateTime } from '../../lib/format'
import {
  IMPORT_STATUS_LABEL,
  IMPORT_STATUS_STYLE,
  listImports,
  resolveImport,
  type BookingImportRow,
} from '../../lib/imports'
import { Button, Dialog, ErrorList, TextInput } from '../ui'

/**
 * Prüfliste der eingelesenen Portal-Mails. Offen sind Umbuchungen, Stornos, unbekannte
 * Mails und Fehler; sie werden von Hand bearbeitet und hier abgehakt.
 * Gilt für manuell eingefügte Mails und später für den automatischen IMAP-Abruf.
 */
export function ImportReviewDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [rows, setRows] = useState<BookingImportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await listImports(onlyOpen))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [onlyOpen])

  useEffect(() => {
    void load()
  }, [load])

  async function resolve(id: string) {
    setBusy(true)
    try {
      await resolveImport(id, note.trim())
      setNote('')
      setOpenId(null)
      onChanged()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Importe prüfen" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Schließen</Button>}>
      <div className="mb-3 flex gap-2" role="group" aria-label="Filter">
        {[
          [true, 'Offen'],
          [false, 'Alle (letzte 100)'],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setOnlyOpen(value as boolean)}
            className={`touch-target rounded-full border px-4 py-1.5 text-sm font-medium ${
              onlyOpen === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface'
            }`}
          >
            {label as string}
          </button>
        ))}
      </div>

      {error && <ErrorList errors={[error]} />}
      {loading && <p className="text-sm text-muted">Lädt …</p>}
      {!loading && rows.length === 0 && (
        <p className="rounded-xl border border-line px-4 py-6 text-center text-sm text-muted">
          {onlyOpen ? 'Nichts zu prüfen.' : 'Noch keine Importe.'}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const expanded = openId === r.id
          const open = r.status === 'needs_review' || r.status === 'failed'
          return (
            <li key={r.id} className="rounded-xl border border-line">
              <button
                type="button"
                onClick={() => {
                  setOpenId(expanded ? null : r.id)
                  setNote('')
                }}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
                aria-expanded={expanded}
              >
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${IMPORT_STATUS_STYLE[r.status]}`}>
                  {IMPORT_STATUS_LABEL[r.status]}
                </span>
                <span className="text-sm font-medium">{MAIL_TYPE_LABEL[r.mail_type]}</span>
                {r.external_ref && <span className="font-mono text-sm">#{r.external_ref}</span>}
                <span className="ml-auto text-xs text-muted">
                  {formatDateTime(r.created_at)} · {r.channel === 'imap' ? 'automatisch' : 'von Hand'}
                </span>
                {r.error && <span className="w-full text-sm text-subtle">{r.error}</span>}
              </button>

              {expanded && (
                <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                  {r.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <span key={f} className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink">
                          {IMPORT_FLAG_LABEL[f] ?? f}
                        </span>
                      ))}
                    </div>
                  )}
                  {(r.subject || r.sender) && (
                    <p className="text-xs text-muted">{[r.subject, r.sender].filter(Boolean).join(' · ')}</p>
                  )}
                  {r.booking_id && (
                    <Link to={`/fahrzeuge/${r.booking_id}`} className="text-sm font-semibold text-accent-dark underline">
                      Zur Buchung
                    </Link>
                  )}
                  <pre className="max-h-64 overflow-auto rounded-lg bg-ground p-2 text-xs whitespace-pre-wrap">{r.raw_text}</pre>
                  {r.review_note && <p className="text-sm">Notiz: {r.review_note}</p>}
                  {open && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <TextInput
                        className="flex-1"
                        placeholder="Was wurde gemacht? (optional)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <Button variant="primary" disabled={busy} onClick={() => void resolve(r.id)}>
                        Als erledigt markieren
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
