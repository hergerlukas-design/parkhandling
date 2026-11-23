import { describe, expect, it } from 'vitest'
import { chargingDescription, chargingTargetFrom, websiteDays, websitePrice } from './tariffs'

const economy = { base_price: 49, extra_day_price: 7.5 }
const args = { startDate: '2026-12-01', endDate: '2026-12-08', returnMode: 'shuttle' as const, charging: false }

describe('Preis wie im Website-Rechner', () => {
  it('zählt Anreise- und Abreisetag voll', () => {
    expect(websiteDays('2026-12-01', '2026-12-01')).toBe(1)
    expect(websiteDays('2026-12-01', '2026-12-05')).toBe(5)
    expect(websiteDays('2026-12-05', '2026-12-01')).toBeNull()
    expect(websiteDays('', '2026-12-01')).toBeNull()
  })

  it('Grundpreis bis 5 Tage, danach Tagespreis', () => {
    expect(websitePrice(economy, { ...args, endDate: '2026-12-03' })?.total).toBe(49)
    expect(websitePrice(economy, { ...args, endDate: '2026-12-05' })?.total).toBe(49)
    const p = websitePrice(economy, args)!
    expect(p.days).toBe(8)
    expect(p.extraDays).toBe(3)
    expect(p.total).toBe(71.5)
  })

  it('Hol-/Bring-Service +24,50 €, Selbst −10 % auf den Parkpreis, Laden +10 €', () => {
    expect(websitePrice(economy, { ...args, returnMode: 'pickup_delivery' })?.total).toBe(96)
    const self = websitePrice(economy, { ...args, returnMode: 'self' })!
    expect(self.discount).toBe(7.15)
    expect(self.total).toBe(64.35)
    expect(websitePrice(economy, { ...args, charging: true })?.total).toBe(81.5)
  })

  it('Ladeziel in der Beschreibung', () => {
    expect(chargingTargetFrom(chargingDescription('100 %'))).toBe('100 %')
    expect(chargingTargetFrom('Laden: ja')).toBe('80 %')
    expect(chargingTargetFrom(null)).toBe('80 %')
  })
})
