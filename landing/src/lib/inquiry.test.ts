import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, type InquiryForm, LIMITS, validateInquiry } from './inquiry'

const TODAY = '2026-10-09'
const valid: InquiryForm = {
  ...EMPTY_FORM,
  arrival_date: '2026-10-12',
  pickup_date: '2026-10-19',
  parking_type: 'indoor',
  plate: 'M-TE 123',
  first_name: 'Test',
  last_name: 'Person',
  email: 'test@example.com',
  consent_privacy: true,
}
const check = (o: Partial<InquiryForm>) => validateInquiry({ ...valid, ...o }, TODAY)

describe('validateInquiry', () => {
  it('gültige Anfrage ohne Fehler', () => {
    expect(check({})).toEqual({})
    expect(check({ phone: '+49 (89) 123-456', services: ['shuttle'], message: 'Hallo' })).toEqual({})
  })

  it('Pflichtfelder', () => {
    expect(Object.keys(validateInquiry(EMPTY_FORM, TODAY)).sort()).toEqual(
      ['arrival_date', 'consent_privacy', 'email', 'first_name', 'last_name', 'parking_type', 'pickup_date', 'plate'],
    )
    expect(check({ first_name: '   ' }).first_name).toBeDefined()
    expect(check({ phone: '' }).phone).toBeUndefined()
    expect(check({ message: '' }).message).toBeUndefined()
  })

  describe('Datumslogik', () => {
    it('Anreise heute erlaubt, gestern nicht', () => {
      expect(check({ arrival_date: TODAY }).arrival_date).toBeUndefined()
      expect(check({ arrival_date: '2026-10-08' }).arrival_date).toMatch(/Vergangenheit/)
    })
    it('Abholung muss nach der Anreise liegen', () => {
      expect(check({ pickup_date: '2026-10-12' }).pickup_date).toMatch(/12\.10\.2026/)
      expect(check({ pickup_date: '2026-10-11' }).pickup_date).toBeDefined()
      expect(check({ pickup_date: '2026-10-13' }).pickup_date).toBeUndefined()
    })
    it('höchstens ein Jahr im Voraus', () => {
      expect(check({ arrival_date: '2027-10-09', pickup_date: '2027-10-10' }).arrival_date).toBeUndefined()
      expect(check({ arrival_date: '2027-10-10', pickup_date: '2027-10-11' }).arrival_date).toMatch(/09\.10\.2027/)
    })
  })

  it('E-Mail-Format', () => {
    for (const bad of ['test', 'test@', 'test@example', 'a b@example.com', '@example.com'])
      expect(check({ email: bad }).email, bad).toBeDefined()
    expect(check({ email: ' vorname.nachname+ads@example.co.uk ' }).email).toBeUndefined()
  })

  it('Maximallängen', () => {
    expect(check({ plate: 'X'.repeat(LIMITS.plate) }).plate).toBeUndefined()
    expect(check({ plate: 'X'.repeat(LIMITS.plate + 1) }).plate).toBeDefined()
    expect(check({ message: 'x'.repeat(LIMITS.message) }).message).toBeUndefined()
    expect(check({ message: 'x'.repeat(LIMITS.message + 1) }).message).toBeDefined()
    expect(check({ last_name: 'x'.repeat(LIMITS.name + 1) }).last_name).toBeDefined()
    expect(check({ email: `${'a'.repeat(250)}@example.com` }).email).toBeDefined()
  })

  it('Datenschutz-Checkbox ist Pflicht', () => {
    expect(check({ consent_privacy: false }).consent_privacy).toBeDefined()
  })
})
