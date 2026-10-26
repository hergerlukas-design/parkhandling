import { describe, expect, it } from 'vitest'
import { berlinTimeOnDay, chargingAmount, durationLabel, formatKwh, parseChargeScan, parseKwh, parseSoc, perKwhBilling, sumKwh } from './charging'

describe('parseChargeScan', () => {
  it('erkennt den Aufkleber am Ladepunkt', () => {
    expect(parseChargeScan('PF-CHG:LP1')).toEqual({ kind: 'charge_point', code: 'LP1' })
    expect(parseChargeScan(' pf-chg:lp2 ')).toEqual({ kind: 'charge_point', code: 'LP2' })
    expect(parseChargeScan('lp1')).toEqual({ kind: 'charge_point', code: 'LP1' })
  })

  it('erkennt den Code vom Display der Kempower-Säule', () => {
    expect(parseChargeScan('https://kempower.io/c/5ca7e9c7-d20a-4e96-9875-9a9ed4cdf4b3?l=de')).toEqual({ kind: 'display' })
  })

  it('alles andere ist kein Ladepunkt', () => {
    expect(parseChargeScan('PF-LOC:W-LAD1').kind).toBe('other')
    expect(parseChargeScan('https://example.com/c/123').kind).toBe('other')
  })
})

describe('Eingaben', () => {
  it('kWh mit Dezimalkomma, höchstens 3 Stellen, 0–500', () => {
    expect(parseKwh('23,412')).toBe(23.412)
    expect(parseKwh('8.5')).toBe(8.5)
    expect(parseKwh('0')).toBe(0)
    expect(parseKwh('23,4125')).toBeNull()
    expect(parseKwh('600')).toBeNull()
    expect(parseKwh('abc')).toBeNull()
  })

  it('Ladestand leer, gültig oder ungültig', () => {
    expect(parseSoc('')).toBeNull()
    expect(parseSoc('80')).toBe(80)
    expect(parseSoc('101')).toBeUndefined()
    expect(parseSoc('8,5')).toBeUndefined()
  })
})

describe('Anzeige', () => {
  it('kWh deutsch formatiert', () => {
    expect(formatKwh(23.4117)).toBe('23,4 kWh')
    expect(formatKwh(23.4117, true)).toBe('23,412 kWh')
    expect(formatKwh(null)).toBe('– kWh')
  })

  it('Dauer', () => {
    expect(durationLabel('2026-10-26T10:00:00Z', '2026-10-26T10:47:00Z')).toBe('47 min')
    expect(durationLabel('2026-10-26T10:00:00Z', '2026-10-26T11:05:00Z')).toBe('1 h 05 min')
    expect(durationLabel(null, null)).toBe('–')
  })

  it('Summe nur beendeter Ladungen', () => {
    expect(sumKwh([{ status: 'ended', energy_kwh: 10.5 }, { status: 'ended', energy_kwh: 2 }, { status: 'charging', energy_kwh: 4 }])).toBe(12.5)
  })
})

describe('Abrechnung pro kWh', () => {
  const ended = { status: 'ended' as const, source: 'api' as const, energy_kwh: 23.412, legal_metering: true }
  const perKwh = { billing_mode: 'per_kwh' as const, price_per_kwh: 0.49 }

  it('rechnet wie die Datenbank', () => {
    expect(chargingAmount(23.412, 0.49)).toBe(11.47)
    expect(perKwhBilling(ended, perKwh)).toMatchObject({ ok: true, amount: 11.47 })
  })

  it('Pauschale: keine Abrechnung pro kWh', () => {
    expect(perKwhBilling(ended, { billing_mode: 'flat', price_per_kwh: 0.49 })).toBeNull()
  })

  it('nur mit eichrechtskonformer Messung und Wert aus der Säule', () => {
    expect(perKwhBilling({ ...ended, legal_metering: false }, perKwh)).toMatchObject({ ok: false })
    expect(perKwhBilling({ ...ended, source: 'manual' }, perKwh)).toMatchObject({ ok: false })
    expect(perKwhBilling({ ...ended, status: 'charging' }, perKwh)).toMatchObject({ ok: false, reason: 'Ladung noch nicht beendet' })
    expect(perKwhBilling(ended, { billing_mode: 'per_kwh', price_per_kwh: null })).toMatchObject({ ok: false })
  })
})

describe('berlinTimeOnDay', () => {
  it('Uhrzeit am Tag der Ladung (MEZ)', () => {
    expect(berlinTimeOnDay('2026-10-26T10:05:00Z', '12:30')).toBe('2026-10-26T11:30:00.000Z')
  })
  it('vor dem Beginn → Folgetag', () => {
    expect(berlinTimeOnDay('2026-10-26T21:00:00Z', '01:15', '2026-10-26T21:00:00Z')).toBe('2026-10-27T00:15:00.000Z')
  })
  it('ungültig → null', () => {
    expect(berlinTimeOnDay('2026-10-26T10:05:00Z', '25:00')).toBeNull()
    expect(berlinTimeOnDay('2026-10-26T10:05:00Z', 'abc')).toBeNull()
  })
})
