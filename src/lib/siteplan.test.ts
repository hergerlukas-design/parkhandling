import { describe, expect, it } from 'vitest'
import { hasKeySlot, keyHint, whereabouts, outdoorSuggestions, parseScan, rankHallSuggestions, recommendedSuggestion, type BoardSlot, type Suggestion } from './siteplan'

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
