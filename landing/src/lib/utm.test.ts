import { describe, expect, it } from 'vitest'
import { captureAttribution, readAttribution } from './utm'

function memoryStorage() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}
const ORIGIN = 'https://park.example'

describe('UTM-Tracking', () => {
  it('liest UTM-Parameter und hält sie in der Sitzung', () => {
    const s = memoryStorage()
    captureAttribution('?utm_source=google&utm_medium=cpc&utm_campaign=herbst&gclid=abc', 'https://www.google.com/', ORIGIN, s)
    // Folgeseite ohne Parameter, interner Referrer
    const a = captureAttribution('', `${ORIGIN}/`, ORIGIN, s)
    expect(a.utm).toEqual({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'herbst' })
    expect(a.referrer).toBe('https://www.google.com/')
    expect(readAttribution(s)).toEqual(a)
  })

  it('neue UTM-Werte ersetzen alte vollständig', () => {
    const s = memoryStorage()
    captureAttribution('?utm_source=google&utm_term=parken', '', ORIGIN, s)
    expect(captureAttribution('?utm_source=meta', '', ORIGIN, s).utm).toEqual({ utm_source: 'meta' })
  })

  it('ignoriert eigenen Referrer und kürzt lange Werte', () => {
    const s = memoryStorage()
    const a = captureAttribution(`?utm_content=${'x'.repeat(300)}`, `${ORIGIN}/anfrage`, ORIGIN, s)
    expect(a.referrer).toBeNull()
    expect(a.utm.utm_content).toHaveLength(200)
  })

  it('funktioniert ohne Speicher (gesperrt)', () => {
    expect(captureAttribution('?utm_source=x', '', ORIGIN, null).utm).toEqual({ utm_source: 'x' })
    expect(readAttribution(null)).toEqual({ utm: {}, referrer: null })
  })
})
