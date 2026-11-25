import { describe, expect, it } from 'vitest'
import { accessExpired, isHelperOnly } from './auth'
import { codeFromHash, helperLink, scannerLink, validPin } from './helpers'
import { helperMayOpen } from '../components/navigation'

const code = 'a'.repeat(64)

describe('Aushilfen-Freischaltung', () => {
  it('baut den Link mit dem Code hinter #', () => {
    expect(helperLink(code, 'https://parkhandling.fly.dev')).toBe(`https://parkhandling.fly.dev/aushilfe#${code}`)
  })
  it('liest nur gültige Codes', () => {
    expect(codeFromHash(`#${code.toUpperCase()}`)).toBe(code)
    expect(codeFromHash('#kurz')).toBeNull()
    expect(codeFromHash('')).toBeNull()
  })
  it('prüft die Scanner-PIN und baut die Adresse', () => {
    expect(validPin('0815')).toBe(true)
    for (const p of ['123', '12345', '12a4', '']) expect(validPin(p)).toBe(false)
    expect(scannerLink('https://parkhandling.fly.dev')).toBe('https://parkhandling.fly.dev/scanner')
  })
  it('erkennt reine Aushilfen', () => {
    expect(isHelperOnly({ role: 'staff', roles: ['helper'] })).toBe(true)
    expect(isHelperOnly({ role: 'staff', roles: ['staff'] })).toBe(false)
    expect(isHelperOnly({ role: 'staff', roles: ['helper', 'staff'] })).toBe(false)
    expect(isHelperOnly(null)).toBe(false)
  })
  it('prüft das Ablaufdatum', () => {
    const now = new Date('2026-11-25T12:00:00Z')
    expect(accessExpired({ access_until: '2026-11-25T23:00:00Z' }, now)).toBe(false)
    expect(accessExpired({ access_until: '2026-11-25T11:59:00Z' }, now)).toBe(true)
    expect(accessExpired({ access_until: null }, now)).toBe(false)
  })
  it('lässt Aushilfen nur Scannen, Annahme, Rückgabe, Einchecken und Protokolle öffnen', () => {
    for (const p of ['/scan', '/einchecken', '/annahme', '/rueckgabe', '/protokoll/annahme/x']) expect(helperMayOpen(p)).toBe(true)
    for (const p of ['/', '/fahrzeuge', '/fahrzeuge/x', '/einstellungen', '/lageplan', '/aufgaben']) expect(helperMayOpen(p)).toBe(false)
  })
})
