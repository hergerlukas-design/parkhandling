import { describe, expect, it } from 'vitest'
import { formatEuro, rentalDays, tierForDays } from './booking'

describe('tierForDays', () => {
  it('ordnet die Dauerklassen der Vorlage zu', () => {
    expect(tierForDays(4)).toBeNull()
    expect(tierForDays(5)).toBe('week')
    expect(tierForDays(8)).toBe('week')
    expect(tierForDays(9)).toBe('holiday')
    expect(tierForDays(15)).toBe('holiday')
    expect(tierForDays(16)).toBe('month')
    expect(tierForDays(30)).toBe('month')
    expect(tierForDays(31)).toBeNull()
  })
})

describe('rentalDays', () => {
  it('zählt Kalendertage zwischen Anreise und Abholung', () => {
    expect(rentalDays({ arrival_date: '2026-10-20', pickup_date: '2026-10-27' })).toBe(7)
  })
  it('liefert null bei fehlenden oder unlogischen Daten', () => {
    expect(rentalDays({ arrival_date: '', pickup_date: '2026-10-27' })).toBeNull()
    expect(rentalDays({ arrival_date: '2026-10-27', pickup_date: '2026-10-20' })).toBeNull()
    expect(rentalDays({ arrival_date: '2026-10-20', pickup_date: '2026-10-20' })).toBeNull()
  })
})

describe('formatEuro', () => {
  it('formatiert Beträge in deutscher Schreibweise', () => {
    expect(formatEuro(148)).toMatch(/148,00\s€/)
    expect(formatEuro(1299.5)).toMatch(/1\.299,50\s€/)
  })
})
