import { describe, expect, it } from 'vitest'
import { outdoorSuggestions, parseScan, rankHallSuggestions, recommendedSuggestion, type BoardSlot, type Suggestion } from './siteplan'

describe('parseScan', () => {
  it('erkennt Schlüssel- und Stellplatz-QR-Codes', () => {
    expect(parseScan('PF-KEY:K-018')).toEqual({ kind: 'key', code: 'K-018' })
    expect(parseScan('pf-loc:r3-e1')).toEqual({ kind: 'location', code: 'R3-E1' })
    expect(parseScan('A1-07')).toEqual({ kind: 'location', code: 'A1-07' })
    expect(parseScan('W-UEB')).toEqual({ kind: 'location', code: 'W-UEB' })
    expect(parseScan('k-140')).toEqual({ kind: 'key', code: 'K-140' })
  })
  it('meldet unbekannte Inhalte', () => {
    expect(parseScan('https://example.com')).toEqual({ kind: 'unknown', code: 'https://example.com' })
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
