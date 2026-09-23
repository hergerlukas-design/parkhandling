import { describe, expect, it } from 'vitest'
import {
  berlinToIso,
  parseDateTime,
  parseParkingType,
  parseReturnMode,
  parseServiceCodes,
  parseTime,
} from './parse'

describe('berlinToIso', () => {
  it('berücksichtigt Sommer- und Winterzeit', () => {
    expect(berlinToIso(2026, 7, 1, 6, 30)).toBe('2026-07-01T04:30:00.000Z')
    expect(berlinToIso(2026, 1, 15, 6, 30)).toBe('2026-01-15T05:30:00.000Z')
  })
  it('lehnt ungültige Daten ab', () => {
    expect(berlinToIso(2026, 2, 30)).toBeNull()
    expect(berlinToIso(2026, 13, 1)).toBeNull()
  })
})

describe('parseDateTime', () => {
  it('liest deutsches Format mit und ohne Uhrzeit', () => {
    expect(parseDateTime('24.09.2026 06:30')).toBe('2026-09-24T04:30:00.000Z')
    expect(parseDateTime('24.09.26')).toBe('2026-09-23T22:00:00.000Z')
    expect(parseDateTime('1.2.2026 7.15 Uhr')).toBe('2026-02-01T06:15:00.000Z')
  })
  it('kombiniert getrennte Datums- und Zeitspalten', () => {
    expect(parseDateTime('24.09.2026', '18:45')).toBe('2026-09-24T16:45:00.000Z')
    expect(parseDateTime('2026-09-24', 0.75)).toBe('2026-09-24T16:00:00.000Z')
  })
  it('übernimmt ISO mit Zeitzone unverändert', () => {
    expect(parseDateTime('2026-09-24T06:30:00+02:00')).toBe('2026-09-24T04:30:00.000Z')
  })
  it('interpretiert Excel-Datumswerte als Berliner Ortszeit', () => {
    expect(parseDateTime(new Date(Date.UTC(2026, 8, 24, 6, 30)))).toBe('2026-09-24T04:30:00.000Z')
    expect(parseDateTime(46289.25)).toBe('2026-09-24T04:00:00.000Z')
  })
  it('meldet ungültige Werte', () => {
    expect(parseDateTime('morgen')).toBeNull()
    expect(parseDateTime('24.09.2026', 'abends')).toBeNull()
    expect(parseDateTime('')).toBeNull()
  })
})

describe('parseTime', () => {
  it('liest gängige Schreibweisen', () => {
    expect(parseTime('6:05')).toEqual([6, 5])
    expect(parseTime('18 Uhr')).toEqual([18, 0])
    expect(parseTime('25:00')).toBeNull()
  })
})

describe('Aufzählungen', () => {
  it('erkennt Parkart', () => {
    expect(parseParkingType('Halle')).toBe('indoor')
    expect(parseParkingType('Außen mit Abdeckplane')).toBe('outdoor_cover')
    expect(parseParkingType('Außenstellplatz')).toBe('outdoor')
    expect(parseParkingType('???')).toBeNull()
  })
  it('erkennt Rückgabeart', () => {
    expect(parseReturnMode('Valet Premium')).toBe('vallet')
    expect(parseReturnMode('Shuttle')).toBe('shuttle')
    expect(parseReturnMode('Selbstabholer')).toBe('self')
  })
  it('zerlegt Leistungslisten', () => {
    expect(parseServiceCodes('innen, Laden; tanken | innen')).toEqual(['INNEN', 'LADEN', 'TANKEN'])
    expect(parseServiceCodes(null)).toEqual([])
  })
})
