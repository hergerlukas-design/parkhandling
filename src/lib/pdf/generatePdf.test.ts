import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { safe } from './generatePdf'

describe('safe', () => {
  it('lässt darstellbare Sonderzeichen stehen', () => {
    expect(safe('– %')).toBe('– %')
    expect(safe('Kunde sagt „kein Kratzer“, ca. 50 € … Müller’s Stoßfänger')).toBe('Kunde sagt „kein Kratzer“, ca. 50 € … Müller’s Stoßfänger')
  })

  it('ersetzt nicht darstellbare Zeichen lesbar', () => {
    expect(safe('Halle → Kunde')).toBe('Halle -> Kunde')
    expect(safe('Dvořák, Čelik')).toBe('Dvorák, Celik')
    expect(safe('Alles gut 👍🏻 ✓')).toBe('Alles gut  x')
    expect(safe('Kunde aus 🇩🇪, ❤️')).toBe('Kunde aus , ')
    expect(safe('Zeile 1\r\nZeile 2')).toBe('Zeile 1\nZeile 2')
    expect(safe('Москва')).toBe('??????')
  })

  it('liefert nur Zeichen, die Helvetica kodieren kann', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    const sample = 'äöüÄÖÜß – — „“ ” ‚‘ ’ € … • ™ → ← ✓ č ł ő 😀 Москва 中文   ​'
    for (const line of safe(sample).split('\n')) expect(() => font.encodeText(line)).not.toThrow()
  })
})
