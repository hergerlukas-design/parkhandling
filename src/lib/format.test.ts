import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatDateTime, formatTime } from './format'

describe('Datumsformat', () => {
  it('formatiert TT.MM.JJJJ in Europe/Berlin', () => {
    // 22:30 UTC am 31.12. ist in Berlin bereits der 01.01.
    expect(formatDate('2025-12-31T23:30:00Z')).toBe('01.01.2026')
  })
  it('formatiert Uhrzeit im 24-h-Format mit Sommerzeit', () => {
    expect(formatTime('2026-07-01T12:05:00Z')).toBe('14:05')
    expect(formatTime('2026-01-01T00:00:00Z')).toBe('01:00')
  })
  it('kombiniert Datum und Uhrzeit', () => {
    expect(formatDateTime('2026-07-01T12:05:00Z')).toBe('01.07.2026 14:05')
  })
})

describe('formatBytes', () => {
  it('nutzt deutsche Dezimaltrennung', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB')
  })
})
