import { describe, expect, it } from 'vitest'
import { generateWithinLimit, PDF_MAX_BYTES, PDF_PHOTO_STEPS } from './protocolPdf'
import type { PhotoQuality } from './pdf/generatePdf'

/** Simuliertes PDF: Größe wächst mit Fotobreite und Qualität */
const fakePdf = (fullSize: number) => {
  const calls: PhotoQuality[] = []
  const generate = async (q: PhotoQuality) => {
    calls.push(q)
    return new Uint8Array(Math.round(fullSize * q.scale * q.scale * (q.quality / 0.72)))
  }
  return { calls, generate }
}

describe('generateWithinLimit', () => {
  it('nimmt die volle Qualität, wenn das PDF passt', async () => {
    const { calls, generate } = fakePdf(800_000)
    const { step } = await generateWithinLimit(generate)
    expect(step).toEqual(PDF_PHOTO_STEPS[0])
    expect(calls).toHaveLength(1)
  })

  it('verkleinert stufenweise, bis das PDF unter die Grenze passt', async () => {
    const { calls, generate } = fakePdf(3_000_000)
    const { bytes, step } = await generateWithinLimit(generate)
    expect(bytes.byteLength).toBeLessThanOrEqual(PDF_MAX_BYTES)
    expect(step).toEqual({ scale: 0.65, quality: 0.55 })
    expect(calls).toHaveLength(3)
  })

  it('liefert das kleinste Ergebnis, wenn keine Stufe passt', async () => {
    const { calls, generate } = fakePdf(100_000_000)
    const { step } = await generateWithinLimit(generate)
    expect(step).toEqual(PDF_PHOTO_STEPS[PDF_PHOTO_STEPS.length - 1])
    expect(calls).toHaveLength(PDF_PHOTO_STEPS.length)
  })

  it('bleibt unter dem Server-Limit von 1,5 MB', () => {
    expect(PDF_MAX_BYTES).toBeLessThan(1_500_000)
  })
})
