// ─────────────────────────────────────────────────────────────────────────────
// PDF erzeugen und teilen bzw. herunterladen – ohne React, aus
// src/components/PdfButton.tsx übernommen.
//
//   1. Web Share API (Android Chrome, Safari 15.1+) → Teilen-Dialog
//   2. iOS ohne Share → neuer Tab (a.download wird dort blockiert)
//   3. sonst klassischer Download
//
// Bricht der Nutzer den Teilen-Dialog ab, ist das kein Fehler.
// ─────────────────────────────────────────────────────────────────────────────

import type { PdfData, PdfOptions } from './generatePdf'

/** Dateiname wie in der App: KENNZEICHEN_JJJJ-MM-TT.pdf */
export function pdfFilename(data: PdfData): string {
  const date = data.inspection_date
    ? new Date(data.inspection_date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  const plate = (data.license_plate || 'Protokoll').replace(/\s/g, '-')
  return `${plate}_${date}.pdf`
}

export async function downloadPdf(
  data: PdfData,
  lang: 'de' | 'en' = 'de',
  options?: PdfOptions
): Promise<void> {
  // pdf-lib erst bei Bedarf laden – hält das Haupt-Bundle klein
  const { generatePdf } = await import('./generatePdf')
  const pdfBytes = await generatePdf(data, lang, options)
  const filename = pdfFilename(data)

  // Uint8Array direkt in den Blob (nicht .buffer, das kann größer sein)
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' })
  await sharePdfBlob(blob, filename)
}

/** Park & Fly: fertiges PDF teilen bzw. herunterladen (aus downloadPdf herausgelöst). */
export async function sharePdfBlob(blob: Blob, filename: string): Promise<void> {
  const shareFile = new File([blob], filename, { type: 'application/pdf' })
  if (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [shareFile] })
  ) {
    try {
      await navigator.share({ files: [shareFile], title: filename })
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) throw err
    }
    return
  }

  const url = URL.createObjectURL(blob)
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  if (isIOS) {
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}
