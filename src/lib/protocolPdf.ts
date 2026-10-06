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
    const bytes = await generatePdf(data, 'de', { labels: pdfLabels(input.type) })
    return {
      blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
      filename: protocolFilename(input.type, input.booking.plate, input.inspectionDate),
    }
  } finally {
    for (const u of objectUrls) URL.revokeObjectURL(u)
  }
}
