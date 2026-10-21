import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import {
  addReviewNote,
  getReviewToken,
  listReviewNotes,
  rememberAuthor,
  type ReviewNote,
  savedAuthor,
  setReviewNoteStatus,
} from '../lib/review'

/** Kommentarfenster der Vorschau. Ohne ?review=<Token> wird nichts angezeigt. */
export function ReviewPanel() {
  const { pathname } = useLocation()
  const [token] = useState(() => getReviewToken())
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [target, setTarget] = useState<{ section: string; label: string } | null>(null)
  const [notes, setNotes] = useState<ReviewNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [author, setAuthor] = useState(savedAuthor)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      setNotes(await listReviewNotes())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kommentare konnten nicht geladen werden.')
    }
  }

  useEffect(() => {
    if (token) void refresh()
    // Einmal beim Start laden; danach aktualisiert das Speichern die Liste
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Auswahlmodus: der nächste Klick auf einen markierten Abschnitt wird zum Kommentarziel
  useEffect(() => {
    if (!picking) return
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-review]')
      if (!el?.dataset.review) return
      e.preventDefault()
      e.stopPropagation()
      setTarget({ section: el.dataset.review, label: el.dataset.reviewLabel ?? el.dataset.review })
      setPicking(false)
      setOpen(true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [picking])

  if (!token) return null

  async function save() {
    if (!target || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      rememberAuthor(author.trim())
      await addReviewNote({ page: pathname, section: target.section, body: text.trim(), author: author.trim() })
      setText('')
      setTarget(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(note: ReviewNote) {
    const next = note.status === 'offen' ? 'erledigt' : 'offen'
    try {
      await setReviewNoteStatus(note.id, next)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ändern fehlgeschlagen.')
    }
  }

  const openCount = notes?.filter((n) => n.status === 'offen').length ?? 0

  return (
    <>
      {picking && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-accent px-4 py-3 font-semibold text-ink shadow">
          <span>Klicke auf den Abschnitt oder Button, den du kommentieren willst.</span>
          <button type="button" onClick={() => setPicking(false)} className="min-h-11 rounded-lg bg-white px-3">
            Abbrechen
          </button>
        </div>
      )}

      {!open && !picking && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 min-h-12 rounded-full bg-ink px-5 font-semibold text-white shadow-lg"
        >
          Kommentare{openCount > 0 ? ` (${openCount})` : ''}
        </button>
      )}

      {open && (
        <section
          aria-label="Kommentare zur Vorschau"
          className="fixed inset-x-0 bottom-0 z-40 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-card p-4 shadow-2xl md:inset-x-auto md:right-4 md:w-[26rem]"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Kommentare</h2>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg px-3 font-medium underline">
              Schließen
            </button>
          </div>

          {error && <p role="alert" className="mt-3 rounded-lg bg-danger/5 p-2 text-sm font-medium text-danger">{error}</p>}

          {target ? (
            <div className="mt-4 space-y-3 rounded-xl border border-line bg-white p-3">
              <p className="text-sm">
                Zu: <strong>{target.label}</strong>
              </p>
              <label className="block text-sm font-medium" htmlFor="review-text">
                Kommentar
              </label>
              <textarea
                id="review-text"
                rows={4}
                maxLength={1000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="block w-full rounded-lg border border-line p-2 text-base"
              />
              <label className="block text-sm font-medium" htmlFor="review-author">
                Name (optional)
              </label>
              <input
                id="review-author"
                type="text"
                maxLength={60}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="block h-11 w-full rounded-lg border border-line px-3 text-base"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !text.trim()}
                  onClick={save}
                  className="min-h-11 flex-1 rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Speichern …' : 'Speichern'}
                </button>
                <button type="button" onClick={() => setTarget(null)} className="min-h-11 rounded-lg border border-line px-4">
                  Verwerfen
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setPicking(true)
              }}
              className="mt-4 min-h-11 w-full rounded-lg bg-ink px-4 font-semibold text-white"
            >
              Neuer Kommentar
            </button>
          )}

          <ul className="mt-5 space-y-3">
            {notes?.length === 0 && <li className="text-sm text-ink-soft">Noch keine Kommentare.</li>}
            {notes?.map((n) => (
              <li key={n.id} className={`rounded-xl border p-3 text-sm ${n.status === 'erledigt' ? 'border-line opacity-60' : 'border-accent-strong/50 bg-white'}`}>
                <p className="font-semibold">{n.section}</p>
                <p className="text-xs text-ink-soft">
                  {n.page} · {n.author || 'ohne Namen'} · {new Date(n.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                <button type="button" onClick={() => toggle(n)} className="mt-2 min-h-11 font-medium underline">
                  {n.status === 'offen' ? 'Als erledigt markieren' : 'Wieder öffnen'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
