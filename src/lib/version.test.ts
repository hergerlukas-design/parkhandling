import { describe, expect, it } from 'vitest'
import { compareSemver, parseSemver, updateKind } from './version'

describe('parseSemver', () => {
  it('liest gültige Versionen', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseSemver('v10.0.1-beta.1')).toEqual({ major: 10, minor: 0, patch: 1 })
  })
  it('lehnt ungültige Werte ab', () => {
    expect(parseSemver('1.2')).toBeNull()
    expect(parseSemver('abc')).toBeNull()
  })
})

describe('compareSemver', () => {
  it('vergleicht numerisch statt lexikalisch', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('0.9.9', '1.0.0')).toBeLessThan(0)
  })
})

describe('updateKind', () => {
  it('erkennt Art des Updates', () => {
    expect(updateKind('1.2.3', '1.2.4')).toBe('patch')
    expect(updateKind('1.2.3', '1.3.0')).toBe('minor')
    expect(updateKind('1.2.3', '2.0.0')).toBe('major')
  })
  it('meldet kein Update bei gleicher oder älterer Version', () => {
    expect(updateKind('1.2.3', '1.2.3')).toBe('none')
    expect(updateKind('1.2.3', '1.2.2')).toBe('none')
    expect(updateKind('1.2.3', 'kaputt')).toBe('none')
  })
})
