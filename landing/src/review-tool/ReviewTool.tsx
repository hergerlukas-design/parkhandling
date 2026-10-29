// Markier-Werkzeug (nur `npm run dev`): mit Stift, Textmarkierung oder Elementauswahl Stellen der
// Landingpage markieren und Notizen dazu schreiben. Notizen landen in landing/review/ (NOTES.md für
// Claude Code). Im Produktions-Build ist dieser Code nicht enthalten.
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { router as appRouter } from '../router'
import {
  captureContext,
  docBox,
  elementAtBoxCenter,
  elementsInBox,
  isToolElement,
  TOOL_ATTR,
  unionBox,
} from './context'
import { toMarkdown } from './markdown'
import type { BackupInfo } from './backup'
import { download, loadBackups, loadNotes, restoreBackup, saveNotes, type StoreMode } from './store'
import { type Box, EMPTY_FILE, KIND_LABEL, type MarkKind, type Point, type ReviewFile, type ReviewMark } from './types'

type Router = typeof appRouter
type Tool = MarkKind | null

interface Draft {
  kind: MarkKind
  box: Box
  strokes?: Point[][]
  rects?: Box[]
  quote?: string
  context: ReviewMark['context']
}

const SHOT_PARAM = 'review-shot'
const PEN = '#e5262e'
const HIGHLIGHT = 'rgba(250, 204, 21, 0.45)'
const ELEMENT = '#2563eb'
const Z = 2147483000

const toolAttr = { [TOOL_ATTR]: '' }

/** Seite ohne den Screenshot-Parameter, z. B. `/anfrage?stellplatz=indoor` */
function pageKey(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete(SHOT_PARAM)
  const q = params.toString()
  return q ? `${pathname}?${q}` : pathname
}

function strokesBox(strokes: Point[][]): Box {
  const pts = strokes.flat()
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function pathData(stroke: Point[]): string {
  if (stroke.length === 1) return `M${stroke[0].x} ${stroke[0].y}l0.1 0`
  return stroke.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')
}

function useDocSize() {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const update = () =>
      setSize({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(document.body)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])
  return size
}

function MarkShapes({ kind, strokes, rects, box, faded }: Pick<Draft, 'kind' | 'strokes' | 'rects' | 'box'> & { faded?: boolean }) {
  const opacity = faded ? 0.35 : 1
  if (kind === 'pen')
    return (
      <g opacity={opacity}>
        {strokes?.map((s, i) => (
          <path key={i} d={pathData(s)} fill="none" stroke={PEN} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
    )
  if (kind === 'text')
    return (
      <g opacity={opacity}>
        {rects?.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={HIGHLIGHT} />)}
      </g>
    )
  return (
    <rect
      x={box.x - 3}
      y={box.y - 3}
      width={box.w + 6}
      height={box.h + 6}
      fill="rgba(37, 99, 235, 0.08)"
      stroke={ELEMENT}
      strokeWidth={3}
      strokeDasharray="8 5"
      rx={4}
      opacity={opacity}
    />
  )
}

const btn: CSSProperties = {
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 10,
  border: '1px solid #d4d0c8',
  background: '#fff',
  color: '#1a1d21',
  font: '600 14px system-ui, sans-serif',
  cursor: 'pointer',
}
const btnActive: CSSProperties = { ...btn, background: '#1a1d21', color: '#fff', border: '1px solid #1a1d21' }
const btnDanger: CSSProperties = { ...btn, color: '#b42318', border: '1px solid #f1c4bf' }
const panel: CSSProperties = {
  background: '#fff',
  color: '#1a1d21',
  border: '1px solid #d4d0c8',
  borderRadius: 14,
  boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
  font: '14px/1.4 system-ui, sans-serif',
}

export function ReviewTool({ router }: { router: Router }) {
  const [location, setLocation] = useState(router.state.location)
  useEffect(() => router.subscribe((state) => setLocation(state.location)), [router])
  const page = pageKey(location.pathname, location.search)
  const shotId = useMemo(() => new URLSearchParams(location.search).get(SHOT_PARAM), [location.search])

  const [file, setFile] = useState<ReviewFile>(EMPTY_FILE)
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<StoreMode>('datei')
  const [expanded, setExpanded] = useState(false)
  const [tool, setTool] = useState<Tool>(null)
  const [showList, setShowList] = useState(false)
  const [listAll, setListAll] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [hover, setHover] = useState<Box | null>(null)
  const [stroke, setStroke] = useState<Point[] | null>(null)
  const [pendingScroll, setPendingScroll] = useState<string | null>(null)
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [backupError, setBackupError] = useState('')
  const doc = useDocSize()
  const strokeRef = useRef<Point[] | null>(null)

  useEffect(() => {
    void loadNotes().then(({ file: f, mode: m }) => {
      setFile(f)
      setMode(m)
      setLoaded(true)
    })
  }, [])

  // Screenshot-Modus (vom Vite-Plugin per Playwright geöffnet): nur diese Markierung zeichnen
  useEffect(() => {
    if (!shotId || !loaded) return
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        document.documentElement.dataset.reviewShot = 'ready'
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [shotId, loaded, doc.h])

  const persist = useCallback(async (next: ReviewFile) => {
    setFile(next)
    setMode(await saveNotes(next))
  }, [])

  const closeEditor = useCallback(() => {
    setDraft(null)
    setEditId(null)
    setText('')
  }, [])

  // Esc: erst Notizfenster schließen, dann Werkzeug ausschalten
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (draft || editId) closeEditor()
      else setTool(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, editId, closeEditor])

  // Beim Seitenwechsel offene Entwürfe verwerfen; ggf. zur gewählten Markierung scrollen
  useEffect(() => {
    closeEditor()
    if (!pendingScroll) return
    const mark = file.marks.find((m) => m.id === pendingScroll)
    setPendingScroll(null)
    if (mark) setTimeout(() => window.scrollTo({ top: Math.max(0, mark.box.y - 120), behavior: 'smooth' }), 50)
    // nur auf Seitenwechsel reagieren
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // --- Text markieren --------------------------------------------------------------------------
  useEffect(() => {
    if (tool !== 'text') return
    const onUp = () =>
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
        const range = sel.getRangeAt(0)
        if (isToolElement(range.commonAncestorContainer)) return
        const rects = Array.from(range.getClientRects())
          .filter((r) => r.width > 1 && r.height > 1)
          .map((r) => ({ x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }))
        if (rects.length === 0) return
        const container = range.commonAncestorContainer
        const primary = container instanceof Element ? container : container.parentElement
        setEditId(null)
        setText('')
        setDraft({
          kind: 'text',
          box: unionBox(rects),
          rects,
          quote: sel.toString().replace(/\s+/g, ' ').trim().slice(0, 500),
          context: captureContext(primary, primary ? [primary] : []),
        })
        sel.removeAllRanges()
      }, 0)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchend', onUp)
    document.addEventListener('keyup', onUp)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchend', onUp)
      document.removeEventListener('keyup', onUp)
    }
  }, [tool])

  // --- Element anklicken -----------------------------------------------------------------------
  useEffect(() => {
    if (tool !== 'element') {
      setHover(null)
      return
    }
    const onMove = (e: MouseEvent) => {
      const el = e.target as Element
      setHover(isToolElement(el) || el === document.body ? null : docBox(el))
    }
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element
      if (isToolElement(el)) return
      e.preventDefault()
      e.stopPropagation()
      setEditId(null)
      setText('')
      setDraft({ kind: 'element', box: docBox(el), context: captureContext(el, [el]) })
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [tool])

  // --- Stift -----------------------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (tool !== 'pen' || e.button !== 0) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    strokeRef.current = [{ x: e.pageX, y: e.pageY }]
    setStroke(strokeRef.current)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = strokeRef.current
    if (!s) return
    const last = s[s.length - 1]
    if (Math.hypot(e.pageX - last.x, e.pageY - last.y) < 2) return
    strokeRef.current = [...s, { x: e.pageX, y: e.pageY }]
    setStroke(strokeRef.current)
  }
  const onPointerUp = () => {
    const s = strokeRef.current
    strokeRef.current = null
    setStroke(null)
    if (!s) return
    // Weiterzeichnen ergänzt den offenen Stift-Entwurf
    const strokes = draft?.kind === 'pen' ? [...(draft.strokes ?? []), s] : [s]
    const box = strokesBox(strokes)
    const padded = { x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 }
    if (draft?.kind !== 'pen') {
      setEditId(null)
      setText('')
    }
    setDraft({
      kind: 'pen',
      box: padded,
      strokes,
      context: captureContext(elementAtBoxCenter(padded), elementsInBox(padded)),
    })
  }

  // --- Speichern / Bearbeiten ------------------------------------------------------------------
  async function saveDraft() {
    if (!draft || !text.trim()) return
    const now = new Date().toISOString()
    const mark: ReviewMark = {
      id: crypto.randomUUID(),
      nr: file.marks.reduce((max, m) => Math.max(max, m.nr), 0) + 1,
      page,
      kind: draft.kind,
      note: text.trim(),
      status: 'offen',
      createdAt: now,
      updatedAt: now,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      box: draft.box,
      ...(draft.strokes ? { strokes: draft.strokes } : {}),
      ...(draft.rects ? { rects: draft.rects } : {}),
      ...(draft.quote ? { quote: draft.quote } : {}),
      context: draft.context,
    }
    closeEditor()
    await persist({ ...file, marks: [...file.marks, mark] })
  }

  async function updateMark(id: string, patch: Partial<ReviewMark>) {
    const updatedAt = new Date().toISOString()
    await persist({ ...file, marks: file.marks.map((m) => (m.id === id ? { ...m, ...patch, updatedAt } : m)) })
  }

  async function deleteMark(id: string) {
    if (!window.confirm('Markierung und Notiz löschen?')) return
    closeEditor()
    await persist({ ...file, marks: file.marks.filter((m) => m.id !== id) })
  }

  function openMark(mark: ReviewMark) {
    setDraft(null)
    setEditId(mark.id)
    setText(mark.note)
  }

  function showMark(mark: ReviewMark) {
    if (mark.page === page) {
      window.scrollTo({ top: Math.max(0, mark.box.y - 120), behavior: 'smooth' })
      openMark(mark)
    } else {
      setPendingScroll(mark.id)
      void router.navigate(mark.page)
    }
  }

  async function toggleBackups() {
    if (backups) return setBackups(null)
    setBackupError('')
    try {
      setBackups(await loadBackups())
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e))
    }
  }

  async function restore(b: BackupInfo) {
    const when = new Date(b.savedAt).toLocaleString('de-DE')
    if (!window.confirm(`Stand vom ${when} (${b.marks} Notizen) wiederherstellen? Der jetzige Stand wird vorher gesichert.`)) return
    closeEditor()
    setBackupError('')
    try {
      setFile(await restoreBackup(b.name))
      setBackups(await loadBackups())
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e))
    }
  }

  function exportFiles() {
    download('NOTES.md', toMarkdown(file, __APP_VERSION__), 'text/markdown')
    download('notes.json', `${JSON.stringify(file, null, 2)}\n`, 'application/json')
  }

  // --- Darstellung -----------------------------------------------------------------------------
  const pageMarks = file.marks.filter((m) => m.page === page && (shotId ? m.id === shotId : m.status === 'offen' || m.id === editId))
  const editMark = editId ? file.marks.find((m) => m.id === editId) ?? null : null
  const editorBox = draft?.box ?? editMark?.box ?? null
  const openCount = file.marks.filter((m) => m.status === 'offen').length
  const listed = file.marks.filter((m) => listAll || m.status === 'offen').sort((a, b) => a.nr - b.nr)

  const overlay = (
    <div
      {...toolAttr}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: doc.w,
        height: doc.h,
        zIndex: Z,
        pointerEvents: tool === 'pen' ? 'auto' : 'none',
        touchAction: tool === 'pen' ? 'none' : 'auto',
        cursor: tool === 'pen' ? 'crosshair' : 'default',
      }}
    >
      <svg width={doc.w} height={doc.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {pageMarks.map((m) => (
          <MarkShapes
            key={m.id}
            {...m}
            // auf deutlich anderer Bildschirmbreite liegt die Markierung evtl. daneben → blass
            faded={!shotId && Math.abs(m.viewport.width - window.innerWidth) > 80}
          />
        ))}
        {draft && <MarkShapes {...draft} />}
        {stroke && <MarkShapes kind="pen" strokes={[stroke]} box={{ x: 0, y: 0, w: 0, h: 0 }} />}
        {hover && (
          <rect x={hover.x} y={hover.y} width={hover.w} height={hover.h} fill="rgba(37,99,235,0.08)" stroke={ELEMENT} strokeWidth={2} />
        )}
      </svg>
      {pageMarks.map((m) => (
        <button
          key={m.id}
          type="button"
          title={m.note}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => !shotId && openMark(m)}
          style={{
            position: 'absolute',
            left: Math.max(2, m.box.x - 14),
            top: Math.max(2, m.box.y - 14),
            minWidth: 28,
            height: 28,
            padding: '0 6px',
            borderRadius: 14,
            border: '2px solid #fff',
            background: m.kind === 'pen' ? PEN : m.kind === 'text' ? '#ca8a04' : ELEMENT,
            color: '#fff',
            font: '700 13px system-ui, sans-serif',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          {m.nr}
        </button>
      ))}
    </div>
  )

  if (shotId) return overlay

  const editorWidth = Math.min(340, window.innerWidth - 24)
  const editor = editorBox && (draft || editMark) && (
    <div
      {...toolAttr}
      style={{
        ...panel,
        position: 'absolute',
        zIndex: Z + 2,
        width: editorWidth,
        left: Math.min(Math.max(12, editorBox.x), Math.max(12, doc.w - editorWidth - 12)),
        top: editorBox.y + editorBox.h + 10,
        padding: 12,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        {editMark ? `#${editMark.nr} · ${KIND_LABEL[editMark.kind]}` : `Neue Markierung · ${KIND_LABEL[draft!.kind]}`}
        {editMark?.status === 'erledigt' && <span style={{ color: '#1f7a4d' }}> · erledigt</span>}
      </div>
      {(draft?.quote ?? editMark?.quote) && (
        <div style={{ fontSize: 13, color: '#4a4f57', marginBottom: 6 }}>„{draft?.quote ?? editMark?.quote}“</div>
      )}
      <textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Was soll hier geändert werden?"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: '1px solid #d4d0c8',
          borderRadius: 8,
          padding: 8,
          font: '15px/1.4 system-ui, sans-serif',
          resize: 'vertical',
        }}
      />
      {draft?.kind === 'pen' && (
        <div style={{ fontSize: 12, color: '#4a4f57', margin: '4px 0' }}>Weiterzeichnen ergänzt diese Markierung.</div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {draft ? (
          <>
            <button type="button" style={btnActive} disabled={!text.trim()} onClick={() => void saveDraft()}>
              Speichern
            </button>
            <button type="button" style={btn} onClick={closeEditor}>
              Verwerfen
            </button>
          </>
        ) : (
          editMark && (
            <>
              <button
                type="button"
                style={btnActive}
                disabled={!text.trim()}
                onClick={() => {
                  void updateMark(editMark.id, { note: text.trim() })
                  closeEditor()
                }}
              >
                Speichern
              </button>
              <button
                type="button"
                style={btn}
                onClick={() => {
                  void updateMark(editMark.id, { status: editMark.status === 'offen' ? 'erledigt' : 'offen' })
                  closeEditor()
                }}
              >
                {editMark.status === 'offen' ? 'Erledigt' : 'Wieder öffnen'}
              </button>
              <button type="button" style={btnDanger} onClick={() => void deleteMark(editMark.id)}>
                Löschen
              </button>
              <button type="button" style={btn} onClick={closeEditor}>
                Schließen
              </button>
            </>
          )
        )}
      </div>
    </div>
  )

  const toolButton = (t: MarkKind, label: string, hint: string) => (
    <button
      type="button"
      title={hint}
      style={tool === t ? btnActive : btn}
      onClick={() => {
        closeEditor()
        setTool(tool === t ? null : t)
      }}
    >
      {label}
    </button>
  )

  const toolbar = (
    <div
      {...toolAttr}
      style={{ position: 'fixed', left: 12, bottom: 12, zIndex: Z + 3, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}
    >
      {expanded && showList && (
        <div style={{ ...panel, width: Math.min(380, window.innerWidth - 24), maxHeight: '55vh', overflowY: 'auto', padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong>Notizen</strong>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={listAll} onChange={(e) => setListAll(e.target.checked)} />
              erledigte zeigen
            </label>
          </div>
          {listed.length === 0 && <div style={{ color: '#4a4f57' }}>Noch keine Notizen. Werkzeug wählen und markieren.</div>}
          {listed.map((m) => (
            <div key={m.id} style={{ borderTop: '1px solid #eee', padding: '8px 0', opacity: m.status === 'erledigt' ? 0.6 : 1 }}>
              <div style={{ fontSize: 12, color: '#4a4f57' }}>
                #{m.nr} · {m.page} · {KIND_LABEL[m.kind]}
                {m.status === 'erledigt' ? ' · erledigt' : ''}
              </div>
              <div style={{ margin: '2px 0 6px', whiteSpace: 'pre-wrap' }}>{m.note}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={btn} onClick={() => showMark(m)}>
                  Anzeigen
                </button>
                <button
                  type="button"
                  style={btn}
                  onClick={() => void updateMark(m.id, { status: m.status === 'offen' ? 'erledigt' : 'offen' })}
                >
                  {m.status === 'offen' ? 'Erledigt' : 'Wieder öffnen'}
                </button>
                <button type="button" style={btnDanger} onClick={() => void deleteMark(m.id)}>
                  Löschen
                </button>
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #eee', paddingTop: 8, fontSize: 12, color: '#4a4f57' }}>
            {mode === 'datei' ? (
              <>Gespeichert in <code>landing/review/NOTES.md</code> – für Claude Code: „/review-umsetzen“.</>
            ) : (
              <>Nur im Browser gespeichert (kein Dev-Server). Bitte exportieren und nach <code>landing/review/</code> legen.</>
            )}
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" style={btn} onClick={exportFiles}>
                Exportieren (NOTES.md + notes.json)
              </button>
              {mode === 'datei' && (
                <button type="button" style={backups ? btnActive : btn} onClick={() => void toggleBackups()}>
                  Sicherungen
                </button>
              )}
            </div>
            {backupError && <div style={{ marginTop: 6, color: '#b42318' }}>{backupError}</div>}
            {backups && (
              <div style={{ marginTop: 6 }}>
                {backups.length === 0 && <div>Noch keine Sicherungen. Sie entstehen bei jeder Änderung an gespeicherten Notizen.</div>}
                {backups.map((b) => (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid #eee', padding: '4px 0' }}>
                    <span>
                      {new Date(b.savedAt).toLocaleString('de-DE')} · {b.marks} {b.marks === 1 ? 'Notiz' : 'Notizen'} ({b.open} offen)
                    </span>
                    <button type="button" style={btn} onClick={() => void restore(b)}>
                      Wiederherstellen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {expanded ? (
        <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, maxWidth: 'calc(100vw - 24px)' }}>
          {toolButton('pen', '✎ Stift', 'Frei zeichnen: einkreisen, unterstreichen, Pfeile …')}
          {toolButton('text', '▤ Text', 'Text markieren (wie beim Kopieren)')}
          {toolButton('element', '⬚ Element', 'Element anklicken (Button, Bild, Feld …)')}
          <button type="button" style={showList ? btnActive : btn} onClick={() => setShowList(!showList)}>
            Liste ({openCount})
          </button>
          <button
            type="button"
            style={btn}
            onClick={() => {
              closeEditor()
              setTool(null)
              setShowList(false)
              setExpanded(false)
            }}
          >
            Fertig
          </button>
          {tool === 'pen' && (
            <div style={{ width: '100%', fontSize: 12, color: '#4a4f57' }}>
              Zeichnen aktiv – zum Scrollen auf dem Handy Stift ausschalten.
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          style={{ ...btnActive, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}
          onClick={() => setExpanded(true)}
        >
          ✎ Markieren{openCount > 0 ? ` · ${openCount} offen` : ''}
        </button>
      )}
    </div>
  )

  return (
    <>
      {overlay}
      {editor}
      {toolbar}
    </>
  )
}
