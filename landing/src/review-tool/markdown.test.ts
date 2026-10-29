import { describe, expect, it } from 'vitest'
import { toMarkdown } from './markdown'
import type { ReviewMark } from './types'

const base: ReviewMark = {
  id: 'a1',
  nr: 1,
  page: '/',
  kind: 'pen',
  note: 'Button größer machen',
  status: 'offen',
  createdAt: '2026-10-26T09:05:00',
  updatedAt: '2026-10-26T09:05:00',
  viewport: { width: 390, height: 844 },
  box: { x: 10.4, y: 200.6, w: 120, h: 48 },
  strokes: [[{ x: 10, y: 200 }]],
  context: {
    section: 'Startseite: Hero',
    heading: 'Sicher parken,\n entspannt fliegen.',
    elements: [{ tag: 'a', selector: 'section[data-review="startseite-hero"] > div > a', text: 'Jetzt buchen' }],
  },
}

describe('toMarkdown', () => {
  it('listet offene Punkte mit Kontext für Claude Code', () => {
    const md = toMarkdown({ version: 1, marks: [base] }, '0.7.0', new Set(['a1']))
    expect(md).toContain('Stand: landing 0.7.0 · 1 offen · 0 erledigt')
    expect(md).toContain('### #1 · `/` · Stift')
    expect(md).toContain('**Notiz:** Button größer machen')
    expect(md).toContain('- Abschnitt: Startseite: Hero')
    expect(md).toContain('- Überschrift darüber: „Sicher parken, entspannt fliegen.“')
    expect(md).toContain('  - `a` „Jetzt buchen“ – `section[data-review="startseite-hero"] > div > a`')
    expect(md).toContain('390 × 844 px, Bereich x 10, y 201, 120 × 48 px')
    expect(md).toContain('- Erstellt: 26.10.2026 09:05')
    expect(md).toContain('![Markierung #1](screens/1.png)')
  })

  it('trennt offen und erledigt, sortiert nach Nummer, Screenshot nur wenn vorhanden', () => {
    const md = toMarkdown(
      {
        version: 1,
        marks: [
          { ...base, id: 'b', nr: 3, kind: 'text', quote: 'Preis auf Anfrage', note: 'Preis nennen' },
          { ...base, id: 'c', nr: 2, status: 'erledigt', note: 'Farbe\nändern' },
        ],
      },
      '0.7.0',
    )
    expect(md).toContain('1 offen · 1 erledigt')
    expect(md).toContain('- Markierter Text: „Preis auf Anfrage“')
    expect(md).not.toContain('screens/')
    expect(md).toContain('## Erledigt\n\n- #2 `/`: Farbe ändern')
  })

  it('leere Liste', () => {
    expect(toMarkdown({ version: 1, marks: [] }, '0.7.0')).toContain('_Keine offenen Punkte._')
  })
})
