import { describe, expect, it } from 'vitest'
import { hallLayout, hasKeySlot, keyHint, outdoorLayout, previewHallLayout, previewOutdoorLayout, whereabouts, outdoorSuggestions, parseScan, rankHallSuggestions, recommendedSuggestion, type BoardSlot, type Suggestion } from './siteplan'

describe('parseScan', () => {
  it('erkennt Schlüssel- und Stellplatz-QR-Codes', () => {
    expect(parseScan('PF-KEY:R1-E1')).toEqual({ kind: 'key', code: 'R1-E1' })
    expect(parseScan('pf-key:a1-07')).toEqual({ kind: 'key', code: 'A1-07' })
    expect(parseScan('pf-loc:r3-e1')).toEqual({ kind: 'location', code: 'R3-E1' })
    expect(parseScan('A1-07')).toEqual({ kind: 'location', code: 'A1-07' })
    expect(parseScan('W-UEB')).toEqual({ kind: 'location', code: 'W-UEB' })
  })
  it('kennt keine Schlüsselanhänger für Arbeits-, Puffer- und Transitplätze', () => {
    expect(parseScan('PF-KEY:W-UEB').kind).toBe('unknown')
    expect(parseScan('PF-KEY:K-018').kind).toBe('unknown')
  })
})

describe('Schlüsselfächer', () => {
  it('gibt es nur für Halle und Außenflächen', () => {
    expect(['R1-E1', 'R8-E3', 'A1-07', 'B2-24'].every(hasKeySlot)).toBe(true)
    expect(['W-AUF1', 'P-01', 'T-VAL', null].some(hasKeySlot)).toBe(false)
  })
  it('sagt, was nach einer Bewegung mit dem Schlüssel passiert', () => {
    expect(keyHint('W-UEB', 'R1-E1')).toBe('Schlüssel ins Fach R1-E1 legen.')
    expect(keyHint(null, 'A1-07')).toBe('Schlüssel ins Fach A1-07 legen.')
    expect(keyHint('R1-E1', 'R4-E2')).toBe('Schlüssel mitnehmen: Fach R1-E1 → Fach R4-E2.')
    expect(keyHint('R1-E1', 'W-AUF1')).toBe('Schlüssel aus Fach R1-E1 nehmen, er geht mit dem Fahrzeug.')
    expect(keyHint('R1-E1', null)).toBe('Schlüssel aus Fach R1-E1 nehmen und mit dem Fahrzeug übergeben.')
    expect(keyHint('W-AUF1', 'P-01')).toBeNull()
    expect(keyHint(null, 'W-AUF1')).toBeNull()
  })
  it('meldet unbekannte Inhalte', () => {
    expect(parseScan('https://example.com')).toEqual({ kind: 'unknown', code: 'https://example.com' })
  })
  it('beschreibt den Ort für Liste und Suche', () => {
    expect(whereabouts('R1-E1')).toBe('Fach R1-E1')
    expect(whereabouts('W-AUF2')).toBe('in Aufbereitung')
    expect(whereabouts('P-01')).toBe('im Puffer')
    expect(whereabouts(null)).toBe('nicht eingecheckt')
  })
})

describe('Platzvorschläge', () => {
  const slot = (code: string, area: BoardSlot['area'], patch: Partial<BoardSlot> = {}) =>
    ({ id: code, code, area, status: 'free', booking_id: null, ...patch }) as BoardSlot
  const sug = (code: string, kind: Suggestion['kind']): Suggestion =>
    ({ location_id: code, code, kind, reason: '', moves: 0, score: 0 })

  it('schlägt außen freie Plätze im passenden Bereich vor, dazu einen Puffer', () => {
    const board = [
      slot('A1-01', 'outdoor_a', { status: 'occupied' }),
      slot('A1-02', 'outdoor_a'),
      slot('B1-01', 'outdoor_b'),
      slot('P-01', 'buffer'),
      slot('P-02', 'buffer'),
    ]
    expect(outdoorSuggestions(board, 'outdoor_cover').map((s) => s.code)).toEqual(['A1-02', 'P-01'])
    expect(outdoorSuggestions(board, 'outdoor').map((s) => s.code)).toEqual(['B1-01', 'P-01'])
  })

  it('kürzt Hallenvorschläge und empfiehlt den ersten passenden Platz', () => {
    const list = [sug('R1-E3', 'fits'), sug('R2-E3', 'fits'), sug('R3-E3', 'fits'), sug('R4-E3', 'fits'),
      sug('R5-E2', 'conflict'), sug('P-01', 'buffer')]
    const ranked = rankHallSuggestions(list)
    expect(ranked.map((s) => s.code)).toEqual(['R1-E3', 'R2-E3', 'R3-E3', 'R5-E2', 'P-01'])
    expect(recommendedSuggestion(ranked)?.code).toBe('R1-E3')
  })

  it('empfiehlt den Puffer, wenn nichts passt', () => {
    expect(recommendedSuggestion([sug('R5-E2', 'conflict'), sug('P-01', 'buffer')])?.code).toBe('P-01')
    expect(recommendedSuggestion([sug('R5-E2', 'relocate')])).toBeNull()
  })
})

describe('Hallengröße', () => {
  const hall = (rack: number, level: number, patch: Partial<BoardSlot> = {}) =>
    ({ id: `R${rack}-E${level}`, code: `R${rack}-E${level}`, area: 'hall', rack, rack_column: 1, level,
      status: 'free', booking_id: null, ...patch }) as BoardSlot
  const board = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((r) => [1, 2, 3].map((e) => hall(r, e)))

  it('liest Regale × Ebenen aus den aktiven Plätzen', () => {
    expect(hallLayout(board)).toEqual({ racks: 8, levels: 3 })
    expect(hallLayout([])).toEqual({ racks: 0, levels: 0 })
  })
  it('zeigt, welche Plätze wegfallen und welche die Umstellung sperren', () => {
    const occupied = board.map((s) => (s.code === 'R6-E1' ? { ...s, booking_id: 'b1', plate: 'M-X 1' } : s))
    const p = previewHallLayout(occupied, 4, 2)
    expect(p.removed).toHaveLength(16)
    expect(p.blockers.map((s) => s.code)).toEqual(['R6-E1'])
    expect(p.added).toBe(0)
  })
  it('zählt neue Plätze beim Vergrößern', () => {
    const p = previewHallLayout(board, 10, 4)
    expect(p.removed).toHaveLength(0)
    expect(p.added).toBe(16)
  })
  it('akzeptiert Plätze bis Ebene 5', () => {
    expect(hasKeySlot('R10-E5')).toBe(true)
    expect(hasKeySlot('R1-E6')).toBe(false)
  })
})

describe('Außenfläche umstellen', () => {
  const place = (row: number, n: number, patch: Partial<BoardSlot> = {}) => {
    const code = `A${row}-${String(n).padStart(2, '0')}`
    return { id: code, code, area: 'outdoor_a', row: `A${row}`, number: n, status: 'free', booking_id: null, ...patch } as BoardSlot
  }
  const board = [1, 2].flatMap((r) => Array.from({ length: 24 }, (_, i) => place(r, i + 1)))

  it('liest Reihen × Plätze je Reihe', () => {
    expect(outdoorLayout(board, 'outdoor_a')).toEqual({ rows: 2, places: 24 })
    expect(outdoorLayout(board, 'outdoor_b')).toEqual({ rows: 0, places: 0 })
  })
  it('zeigt wegfallende und sperrende Plätze', () => {
    const occupied = board.map((s) => (s.code === 'A2-03' ? { ...s, status: 'reserved' as const } : s))
    const p = previewOutdoorLayout(occupied, 'outdoor_a', 1, 20)
    expect(p.removed).toHaveLength(28)
    expect(p.blockers.map((s) => s.code)).toEqual(['A2-03'])
    expect(previewOutdoorLayout(board, 'outdoor_a', 3, 30).added).toBe(42)
  })
})
