import type { PhotoQuality } from './pdf/generatePdf'
import type { ProtocolType } from '../types/domain'
import { getMediaStore } from './media'
import { fullRef } from './media/mediaService'
import { buildPdfData, pdfLabels, pickSlotUrls, type Comparison, type ProtocolBooking, type ProtocolForm, type SlotMedia } from './protocols'

/** Dateiname: Annahme_KENNZEICHEN_JJJJ-MM-TT.pdf */
export function protocolFilename(type: ProtocolType, plate: string, date: string): string {
  const day = new Date(date).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  return `${type === 'intake' ? 'Annahme' : 'Uebergabe'}_${plate.replace(/\s+/g, '-')}_${day}.pdf`
}

/**
 * Obergrenze für das Protokoll-PDF: Bucket und media-sign nehmen höchstens 1,5 MB
 * (settings.upload_limits.max_bytes); etwas Abstand für Rundung und spätere Änderungen.
 */
export const PDF_MAX_BYTES = 1_400_000

/** Stufen, in denen die Fotos verkleinert werden, bis das PDF passt */
export const PDF_PHOTO_STEPS: PhotoQuality[] = [
  { scale: 1, quality: 0.72 },
  { scale: 0.8, quality: 0.62 },
  { scale: 0.65, quality: 0.55 },
  { scale: 0.5, quality: 0.5 },
  { scale: 0.4, quality: 0.45 },
]

/**
 * Erzeugt das PDF stufenweise mit kleineren Fotos, bis es unter maxBytes liegt.
 * Passt auch die kleinste Stufe nicht, wird das kleinste Ergebnis zurückgegeben.
 */
export async function generateWithinLimit(
  generate: (q: PhotoQuality) => Promise<Uint8Array>,
  maxBytes = PDF_MAX_BYTES,
  steps = PDF_PHOTO_STEPS,
): Promise<{ bytes: Uint8Array; step: PhotoQuality }> {
  let smallest: { bytes: Uint8Array; step: PhotoQuality } | null = null
  for (const step of steps) {
    const bytes = await generate(step)
    if (bytes.byteLength <= maxBytes) return { bytes, step }
    if (!smallest || bytes.byteLength < smallest.bytes.byteLength) smallest = { bytes, step }
  }
  if (!smallest) throw new Error('Keine Stufe für die PDF-Erzeugung angegeben')
  return smallest
}

/**
 * PDF im Browser mit der Vorlage aus fahrzeug-protokolle-v2 erzeugen.
 * Hochgeladene Fotos kommen über kurzlebige Signed URLs, noch wartende aus der lokalen Queue.
 */
export async function createProtocolPdf(input: {
  type: ProtocolType
  status: 'draft' | 'final'
  form: ProtocolForm
  booking: ProtocolBooking
  media: SlotMedia[]
  pending: { slot: string | null; blob: Blob; created_at: string }[]
  inspectionDate: string
  comparison?: Comparison | null
}): Promise<{ blob: Blob; filename: string }> {
  const objectUrls: string[] = []
  try {
    const store = getMediaStore()
    const uploaded = await Promise.all(
      input.media
        .filter((m) => m.slot && m.kind !== 'pdf')
        .map(async (m) => ({ slot: m.slot, created_at: m.created_at, url: await store.getViewUrl(fullRef(m), { expiresIn: 300 }) })),
    )
    const local = input.pending.map((p) => {
      const url = URL.createObjectURL(p.blob)
      objectUrls.push(url)
      return { slot: p.slot, created_at: p.created_at, url }
    })
    const slotUrls = pickSlotUrls([...uploaded, ...local])
    const data = buildPdfData({ ...input, slotUrls })
    const { generatePdf } = await import('./pdf/generatePdf')
    const { bytes } = await generateWithinLimit((photoQuality) =>
      generatePdf(data, 'de', { labels: pdfLabels(input.type), photoQuality }),
    )
    return {
      blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
      filename: protocolFilename(input.type, input.booking.plate, input.inspectionDate),
    }
  } finally {
    for (const u of objectUrls) URL.revokeObjectURL(u)
  }
}
