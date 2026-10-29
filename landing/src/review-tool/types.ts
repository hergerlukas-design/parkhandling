// Markier-Werkzeug (nur Entwicklung): Datenmodell der Markierungen und Notizen.
// Gespeichert in landing/review/notes.json, lesbar aufbereitet in landing/review/NOTES.md.

export type MarkKind = 'pen' | 'text' | 'element'
export type MarkStatus = 'offen' | 'erledigt'

export interface Point {
  x: number
  y: number
}

/** Rechteck in Dokument-Koordinaten (px, inkl. Scroll-Position) */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface MarkedElement {
  /** z. B. `a`, `h2`, `button` */
  tag: string
  /** kurzer CSS-Pfad zum Wiederfinden */
  selector: string
  /** sichtbarer Text (gekürzt) */
  text: string
}

export interface MarkContext {
  /** data-review-label des umgebenden Abschnitts */
  section: string | null
  /** nächste Überschrift oberhalb */
  heading: string | null
  elements: MarkedElement[]
}

export interface ReviewMark {
  id: string
  nr: number
  /** Pfad inkl. Query, z. B. `/anfrage?stellplatz=indoor` */
  page: string
  kind: MarkKind
  note: string
  status: MarkStatus
  createdAt: string
  updatedAt: string
  viewport: { width: number; height: number }
  box: Box
  strokes?: Point[][]
  rects?: Box[]
  quote?: string
  context: MarkContext
}

export interface ReviewFile {
  version: 1
  marks: ReviewMark[]
}

export const EMPTY_FILE: ReviewFile = { version: 1, marks: [] }

export const KIND_LABEL: Record<MarkKind, string> = {
  pen: 'Stift',
  text: 'Text',
  element: 'Element',
}

export function isReviewFile(value: unknown): value is ReviewFile {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as ReviewFile).version === 1 &&
    Array.isArray((value as ReviewFile).marks)
  )
}
