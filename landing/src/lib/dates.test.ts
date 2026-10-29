import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, formatDateDE, formatDateLongDE, isIsoDate, todayInBerlin } from './dates'

describe('Datumshilfen', () => {
  it('heute in Europe/Berlin, auch kurz vor Mitternacht UTC', () => {
    expect(todayInBerlin(new Date('2026-10-09T21:30:00Z'))).toBe('2026-10-09')
    expect(todayInBerlin(new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-10') // MESZ
    expect(todayInBerlin(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01') // MEZ
  })

  it('deutsches Format TT.MM.JJJJ', () => {
    expect(formatDateDE('2026-03-05')).toBe('05.03.2026')
    expect(formatDateDE('kaputt')).toBe('')
    expect(formatDateLongDE('2026-10-12')).toBe('Mo., 12.10.2026')
  })

  it('erkennt ungültige Kalenderdaten', () => {
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('12.10.2026')).toBe(false)
  })

  it('rechnet Tage über Monats- und Zeitumstellung', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3)
  })
})
