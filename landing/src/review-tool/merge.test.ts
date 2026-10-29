import { describe, expect, it } from 'vitest'
import { mergeMarks, missingMarks } from './merge'
import type { ReviewFile, ReviewMark } from './types'

const mark = (id: string, nr: number): ReviewMark =>
  ({ id, nr, page: '/', kind: 'element', note: id, status: 'offen' }) as ReviewMark
const file = (...marks: ReviewMark[]): ReviewFile => ({ version: 1, marks })

describe('Notizen aus dem Browser übernehmen', () => {
  it('übernimmt nur fehlende Markierungen, vorhandene bleiben unverändert', () => {
    const inFile = { ...mark('a', 1), status: 'erledigt' as const }
    const merged = mergeMarks(file(inFile), file(mark('a', 1), mark('b', 2)))
    expect(merged.marks).toEqual([inFile, mark('b', 2)])
    expect(missingMarks(merged, file(mark('a', 1), mark('b', 2)))).toEqual([])
  })

  it('vergibt bei belegter Nummer die nächste freie', () => {
    const merged = mergeMarks(file(mark('a', 1), mark('b', 2)), file(mark('x', 1), mark('y', 5)))
    expect(merged.marks.map((m) => [m.id, m.nr])).toEqual([
      ['a', 1],
      ['b', 2],
      ['x', 3],
      ['y', 5],
    ])
  })

  it('leere Datei übernimmt alles mit den bisherigen Nummern', () => {
    expect(mergeMarks(file(), file(mark('a', 1), mark('b', 2))).marks.map((m) => m.nr)).toEqual([1, 2])
  })
})
