// Erfasst, WAS unter einer Markierung liegt (Abschnitt, Überschrift, Elemente mit Text und CSS-Pfad),
// damit Claude Code die Stelle im Code findet.
import type { Box, MarkContext, MarkedElement } from './types'

export const TOOL_ATTR = 'data-review-tool'

export function isToolElement(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement
  return !!el?.closest(`[${TOOL_ATTR}]`)
}

const IGNORED = new Set(['HTML', 'BODY', 'MAIN', 'svg', 'path'])

/** Kurzer, möglichst stabiler CSS-Pfad (bricht an id, data-review oder data-testid ab) */
export function cssPath(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.body && parts.length < 5) {
    const tag = cur.tagName.toLowerCase()
    const review = cur.getAttribute('data-review')
    const testId = cur.getAttribute('data-testid')
    if (cur.id) {
      parts.unshift(`${tag}#${CSS.escape(cur.id)}`)
      break
    }
    if (review) {
      parts.unshift(`${tag}[data-review="${review}"]`)
      break
    }
    if (testId) {
      parts.unshift(`${tag}[data-testid="${testId}"]`)
      break
    }
    const parent: Element | null = cur.parentElement
    const siblings = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName) : []
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})` : tag)
    cur = parent
  }
  return parts.join(' > ')
}

function visibleText(el: Element): string {
  const h = el as HTMLElement
  const own =
    el.getAttribute('aria-label') ??
    el.getAttribute('alt') ??
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.placeholder || el.value : null) ??
    h.innerText ??
    el.textContent ??
    ''
  const text = own.replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

export function describeElement(el: Element): MarkedElement {
  return { tag: el.tagName.toLowerCase(), selector: cssPath(el), text: visibleText(el) }
}

/** Oberstes Seitenelement an einem Punkt im Fenster (Werkzeug-Ebene wird übersprungen) */
function pageElementAt(clientX: number, clientY: number): Element | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!isToolElement(el) && !IGNORED.has(el.tagName)) return el
  }
  return null
}

/** Elemente unter einem Bereich (Raster-Stichproben), nur die spezifischsten, max. 6 */
export function elementsInBox(box: Box): Element[] {
  const found = new Set<Element>()
  const steps = 5
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = box.x + (box.w * i) / steps - window.scrollX
      const y = box.y + (box.h * j) / steps - window.scrollY
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue
      const el = pageElementAt(x, y)
      if (el) found.add(el)
    }
  }
  const list = [...found]
  // Nur die innersten behalten: ein Element, das ein anderes gefundenes enthält, fällt weg
  const specific = list.filter((el) => !list.some((other) => other !== el && el.contains(other)))
  return specific.filter((el) => visibleText(el) || el.matches('img, input, select, textarea, button, a')).slice(0, 6)
}

export function elementAtBoxCenter(box: Box): Element | null {
  const x = box.x + box.w / 2 - window.scrollX
  const y = box.y + box.h / 2 - window.scrollY
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null
  return pageElementAt(x, y)
}

/** Letzte Überschrift (h1–h3), die im Dokument vor dem Element steht oder es enthält */
function headingBefore(el: Element): string | null {
  let result: string | null = null
  for (const h of document.querySelectorAll('h1, h2, h3')) {
    if (isToolElement(h)) continue
    const pos = h.compareDocumentPosition(el)
    if (h === el || pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY)
      result = visibleText(h)
  }
  return result
}

export function captureContext(primary: Element | null, elements: Element[]): MarkContext {
  const anchor = primary ?? elements[0] ?? null
  const sectionEl = anchor?.closest('[data-review-label]')
  return {
    section: sectionEl?.getAttribute('data-review-label') ?? null,
    heading: anchor ? headingBefore(anchor) : null,
    elements: (elements.length > 0 ? elements : anchor ? [anchor] : []).map(describeElement),
  }
}

/** Element-Rechteck in Dokument-Koordinaten */
export function docBox(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }
}

export function unionBox(boxes: Box[]): Box {
  const x1 = Math.min(...boxes.map((b) => b.x))
  const y1 = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.w))
  const y2 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
