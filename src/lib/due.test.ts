import { describe, expect, it } from 'vitest'
import { daysUntil, dueCategory, formatPeriod, formatPickup } from './due'

// 23.09.2026 23:30 Berlin (21:30 UTC)
const now = new Date('2026-09-23T21:30:00Z')

describe('dueCategory', () => {
  it('rechnet in Kalendertagen Europe/Berlin', () => {
    expect(daysUntil('2026-09-23T22:30:00Z', now)).toBe(1) // 00:30 am 24.09. Berlin
    expect(dueCategory('2026-09-23T20:00:00Z', now)).toBe('today')
    expect(dueCategory('2026-09-24T10:00:00Z', now)).toBe('tomorrow')
    expect(dueCategory('2026-09-30T10:00:00Z', now)).toBe('week')
    expect(dueCategory('2026-10-05T10:00:00Z', now)).toBe('later')
  })
  it('zählt überfällige Abholungen als heute', () => {
    expect(dueCategory('2026-09-20T10:00:00Z', now)).toBe('today')
  })
})

describe('Formatierung', () => {
  it('beschreibt die Abholung relativ', () => {
    expect(formatPickup('2026-09-23T12:30:00Z', now)).toBe('heute 14:30')
    expect(formatPickup('2026-09-24T05:45:00Z', now)).toBe('morgen 07:45')
    expect(formatPickup('2026-09-25T07:00:00Z', now)).toBe('25.09. 09:00')
  })
  it('zeigt den Zeitraum kompakt', () => {
    expect(formatPeriod('2026-09-17T08:00:00Z', '2026-09-23T15:00:00Z')).toBe('17.09.–23.09.')
  })
})
