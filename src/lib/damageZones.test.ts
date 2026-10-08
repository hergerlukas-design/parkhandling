import { describe, expect, it } from 'vitest'
import { INTERIOR, viewOf, viewsWith, ZONE_TO_VIEW } from './damageZones'
import { DAMAGE_POSITIONS } from './protocols'

describe('Schadensgrafik', () => {
  it('deckt jede Schadensposition des Protokolls ab', () => {
    for (const pos of DAMAGE_POSITIONS) {
      if (pos === INTERIOR) continue
      expect(viewOf(pos), pos).not.toBeNull()
    }
  })

  it('kennt nur Positionen aus dem Protokoll (PDF-Vorlage)', () => {
    const known = new Set<string>(DAMAGE_POSITIONS)
    for (const pos of Object.keys(ZONE_TO_VIEW)) expect(known.has(pos), pos).toBe(true)
  })

  it('markiert die Ansichten mit Schäden', () => {
    expect([...viewsWith(['Tür vorne links', 'Dach', INTERIOR, ''])].sort()).toEqual(['left', 'top'])
  })
})
