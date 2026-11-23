import { describe, expect, it } from 'vitest'
import { emptyServiceForm, normalizeServiceCode, serviceToForm, validateServiceForm } from './services'
import type { Service } from '../types/domain'

const form = () => ({ ...emptyServiceForm(), name: 'Reinigung außen', code: 'aussen', category: 'cleaning' })

describe('Leistungskatalog', () => {
  it('vereinheitlicht Codes', () => {
    expect(normalizeServiceCode(' Reinigung außen ')).toBe('REINIGUNG_AUSSEN')
    expect(normalizeServiceCode('Check Luftdruck & Flüssigkeiten')).toBe('CHECK_LUFTDRUCK_FLUESSIGKEITEN')
  })

  it('prüft Pflichtfelder, Preis und doppelte Codes', () => {
    const ok = validateServiceForm({ ...form(), price: '12,50', steps: [' Außenwäsche ', '', 'Trocknen'] })
    expect(ok).toEqual({
      ok: true,
      row: expect.objectContaining({ code: 'AUSSEN', price: 12.5, steps: ['Außenwäsche', 'Trocknen'], sort_order: 100 }),
    })
    expect(validateServiceForm({ ...form(), name: '' }).ok).toBe(false)
    expect(validateServiceForm({ ...form(), price: 'abc' }).ok).toBe(false)
    expect(validateServiceForm({ ...form(), category: 'x' }).ok).toBe(false)
    expect(validateServiceForm(form(), ['AUSSEN']).ok).toBe(false)
    // bestehende Leistung: eigener Code ist kein Duplikat
    expect(validateServiceForm({ ...form(), id: 'x' }, ['AUSSEN']).ok).toBe(true)
  })

  it('ohne Preis bleibt der Preis leer', () => {
    const r = validateServiceForm(form())
    expect(r.ok && r.row.price).toBeNull()
  })

  it('übernimmt eine Leistung ins Formular', () => {
    const s = { id: 'a', code: 'GRUND', name: 'Reinigung innen', description: null, category: 'cleaning', price: 10, steps: ['Saugen'], active: true, is_default: true, sort_order: 10 } as unknown as Service
    expect(serviceToForm(s)).toMatchObject({ id: 'a', price: '10,00', steps: ['Saugen'], sort_order: '10', description: '' })
  })
})
