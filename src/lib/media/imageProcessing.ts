/**
 * Bildverarbeitung vor dem Upload (Abschnitt 11.1). Läuft im Web Worker
 * (OffscreenCanvas) oder als Fallback im Hauptthread (HTMLCanvasElement).
 * Durch das Neu-Kodieren über Canvas werden alle EXIF-Daten (inkl. GPS) entfernt;
 * die Ausrichtung wird vorher über createImageBitmap angewendet.
 */

export interface EncodeSpec {
  maxEdge: number
  /** Bevorzugtes Format. Unterstützt der Browser kein WebP-Encoding, wird JPEG verwendet. */
  format: 'webp' | 'png'
  quality: number
  /** Zielgröße; bei Überschreitung wird die Qualität schrittweise gesenkt. */
  targetBytes: number
  minQuality: number
}

export const FULL_SPEC: EncodeSpec = {
  maxEdge: 1600,
  format: 'webp',
  quality: 0.75,
  targetBytes: 250_000,
  minQuality: 0.5,
}

export const THUMB_SPEC: EncodeSpec = {
  maxEdge: 320,
  format: 'webp',
  quality: 0.7,
  targetBytes: 20_000,
  minQuality: 0.45,
}

export const SIGNATURE_SPEC: EncodeSpec = {
  maxEdge: 800,
  format: 'png',
  quality: 1,
  targetBytes: 60_000,
  minQuality: 1,
}

export interface EncodedImage {
  blob: Blob
  width: number
  height: number
}

export interface ProcessedImage {
  full: EncodedImage
  thumb: EncodedImage | null
}

/** Skaliert proportional auf maximal `maxEdge` an der längsten Kante (nie vergrößern). */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Qualitätsstufen von `start` in 0,1er-Schritten bis `min`. */
export function qualitySteps(start: number, min: number): number[] {
  const steps: number[] = []
  for (let q = start; q >= min - 1e-9; q -= 0.1) steps.push(Math.round(q * 100) / 100)
  return steps.length ? steps : [start]
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

export interface CanvasFactory {
  create(width: number, height: number): AnyCanvas
  toBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob>
}

export const offscreenCanvasFactory: CanvasFactory = {
  create: (w, h) => new OffscreenCanvas(w, h),
  toBlob: (canvas, type, quality) => (canvas as OffscreenCanvas).convertToBlob({ type, quality }),
}

export const domCanvasFactory: CanvasFactory = {
  create(w, h) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    return canvas
  },
  toBlob: (canvas, type, quality) =>
    new Promise((resolve, reject) =>
      (canvas as HTMLCanvasElement).toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht kodiert werden'))),
        type,
        quality,
      ),
    ),
}

export async function encodeBitmap(
  bitmap: ImageBitmap,
  spec: EncodeSpec,
  factory: CanvasFactory,
): Promise<EncodedImage> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, spec.maxEdge)
  const canvas = factory.create(width, height)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('Canvas nicht verfügbar')
  if (spec.format !== 'png') {
    // Transparente Bereiche nicht schwarz werden lassen
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)

  if (spec.format === 'png') {
    return { blob: await factory.toBlob(canvas, 'image/png', 1), width, height }
  }

  let type = 'image/webp'
  let blob: Blob | null = null
  for (const quality of qualitySteps(spec.quality, spec.minQuality)) {
    blob = await factory.toBlob(canvas, type, quality)
    if (blob.type !== type) {
      // Browser ohne WebP-Encoder (z. B. Safari) liefert PNG → auf JPEG ausweichen
      type = 'image/jpeg'
      blob = await factory.toBlob(canvas, type, quality)
    }
    if (blob.size <= spec.targetBytes) break
  }
  return { blob: blob!, width, height }
}

export async function processImageBlob(
  source: Blob,
  factory: CanvasFactory,
  options: { thumbnail: boolean; spec?: EncodeSpec } = { thumbnail: true },
): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const full = await encodeBitmap(bitmap, options.spec ?? FULL_SPEC, factory)
    const thumb = options.thumbnail ? await encodeBitmap(bitmap, THUMB_SPEC, factory) : null
    return { full, thumb }
  } finally {
    bitmap.close()
  }
}
