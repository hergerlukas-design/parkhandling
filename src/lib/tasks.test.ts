import { describe, expect, it } from 'vitest'
import { formatEnergyParts, formatKwh, parseKwh, sumEnergy } from './tasks'

describe('kWh bei Ladeaufgaben', () => {
  it('nimmt Dezimalkomma und Punkt, höchstens 3 Nachkommastellen', () => {
    expect(parseKwh('23,4')).toBe(23.4)
    expect(parseKwh(' 8.125 ')).toBe(8.125)
    expect(parseKwh('0')).toBe(0)
  })

  it('lehnt Unsinn und Werte über 500 ab', () => {
    expect(parseKwh('')).toBeNull()
    expect(parseKwh('abc')).toBeNull()
    expect(parseKwh('23,4567')).toBeNull()
    expect(parseKwh('501')).toBeNull()
    expect(parseKwh('-3')).toBeNull()
  })

  it('zeigt deutsch formatiert', () => {
    expect(formatKwh(23.4)).toBe('23,4 kWh')
    expect(formatKwh(41)).toBe('41,0 kWh')
    expect(formatKwh(8.125)).toBe('8,125 kWh')
    expect(formatKwh(null)).toBe('– kWh')
  })
})

describe('mehrere Ladevorgänge', () => {
  it('summiert ohne Rundungsfehler', () => {
    expect(sumEnergy([{ kwh: 3.1 }, { kwh: 22.5 }])).toBe(25.6)
    expect(sumEnergy([{ kwh: 0.1 }, { kwh: 0.2 }])).toBe(0.3)
    expect(sumEnergy([])).toBe(0)
  })
  it('zeigt die Einzelwerte', () => {
    expect(formatEnergyParts([{ kwh: 3.1 }, { kwh: 22.5 }])).toBe('3,1 + 22,5')
  })
})
