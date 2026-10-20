import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  // Node-Testumgebung: nur die von toReport genutzten Browser-Globals
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
})

const { sanitize, toReport } = await import('./errorReporting')

describe('sanitize', () => {
  it('entfernt Tokens aus Signed URLs', () => {
    expect(sanitize('GET https://x.supabase.co/storage/v1/object/sign/media/a.webp?token=abc.def&x=1 failed')).toBe(
      'GET https://x.supabase.co/storage/v1/object/sign/media/a.webp?token=…&x=1 failed',
    )
  })

  it('entfernt JWTs und E-Mail-Adressen', () => {
    expect(sanitize('Bearer eyJhbGciOi.eyJzdWIi.sig für kunde@example.com')).toBe('Bearer eyJ… für …@…')
  })
})

describe('toReport', () => {
  it('übernimmt Name, Meldung und Pfad ohne Query', () => {
    const r = toReport('error', new TypeError('x is undefined'), '/fahrzeuge/1?tab=a')
    expect(r).toMatchObject({ kind: 'error', message: 'TypeError: x is undefined', route: '/fahrzeuge/1' })
    expect(r?.stack).toContain('TypeError')
  })

  it('ignoriert Rauschen', () => {
    expect(toReport('error', 'ResizeObserver loop completed with undelivered notifications.', '/')).toBeNull()
    expect(toReport('error', 'Script error.', '/')).toBeNull()
  })

  it('ignoriert Netzfehler, wenn das Gerät offline ist', () => {
    ;(navigator as { onLine: boolean }).onLine = false
    expect(toReport('unhandledrejection', new TypeError('Failed to fetch'), '/')).toBeNull()
    ;(navigator as { onLine: boolean }).onLine = true
    expect(toReport('unhandledrejection', new TypeError('Failed to fetch'), '/')).not.toBeNull()
  })

  it('wandelt Nicht-Fehler-Werte in Text', () => {
    expect(toReport('unhandledrejection', { code: 42 }, '/')?.message).toBe('{"code":42}')
  })
})
