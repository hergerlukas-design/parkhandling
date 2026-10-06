import { describe, expect, it } from 'vitest'
import { parseScan } from './siteplan'

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
