import { describe, expect, it } from 'vitest'
import { arrivalTooSoon, bookableDays, earliestArrival, formatEuro, priceForDays, rentalDays } from './booking'

describe('Preismodell', () => {
  it('ist von 5 bis 30 Tagen online buchbar', () => {
    expect(bookableDays(4)).toBe(false)
    expect(bookableDays(5)).toBe(true)
    expect(bookableDays(30)).toBe(true)
    expect(bookableDays(31)).toBe(false)
  })

  it('rechnet Grundpreis bis 5 Tage plus Preis je weiterem Tag', () => {
    const economy = { base_price: 49, extra_day_price: 7.5 }
    expect(priceForDays(economy, 5)).toBe(49)
    expect(priceForDays(economy, 6)).toBe(56.5)
    expect(priceForDays(economy, 7)).toBe(64)
    expect(priceForDays(economy, 14)).toBe(116.5)
    expect(priceForDays({ base_price: 98, extra_day_price: 14 }, 14)).toBe(224)
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

describe('Vorlauf 12 Stunden', () => {
  // 20.10.2026 10:00 Berliner Zeit (Sommerzeit)
  const now = new Date('2026-10-20T08:00:00.000Z')

  it('frühestmögliche Anreise ist jetzt + 12 Stunden in Berliner Zeit', () => {
    expect(earliestArrival(now)).toEqual({ date: '2026-10-20', time: '22:00' })
    expect(earliestArrival(new Date('2026-10-20T13:00:00.000Z'))).toEqual({ date: '2026-10-21', time: '03:00' })
  })

  it('erkennt eine zu frühe Anreise an Datum und Uhrzeit', () => {
    expect(arrivalTooSoon({ arrival_date: '2026-10-20', arrival_time: '21:59' }, now)).toBe(true)
    expect(arrivalTooSoon({ arrival_date: '2026-10-20', arrival_time: '22:00' }, now)).toBe(false)
    expect(arrivalTooSoon({ arrival_date: '2026-10-20', arrival_time: '' }, now)).toBe(false)
    expect(arrivalTooSoon({ arrival_date: '2026-10-19', arrival_time: '' }, now)).toBe(true)
    expect(arrivalTooSoon({ arrival_date: '2026-10-21', arrival_time: '06:00' }, now)).toBe(false)
  })
})
