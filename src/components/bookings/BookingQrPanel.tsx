import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { bookingQr, qrFilename } from '../../lib/bookingQr'
import { Button, Dialog } from '../ui'

/** QR-Code als PNG teilen (Handy) bzw. herunterladen (Desktop) */
async function sharePng(dataUrl: string, filename: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob()
  const file = new File([blob], filename, { type: 'image/png' })
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) throw err
    }
    return
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

/**
 * QR-Code der Buchung im Fahrzeug-Detail: zum Vorzeigen, Abfotografieren oder Schicken an den Kunden.
 * Scannen startet die Annahme (Rechner-Ticket, PH-Buchungsnummer oder Buchungs-ID).
 */
export function BookingQrPanel({ booking }: {
  booking: { id: string; plate: string; external_ref: string | null; notes: string | null }
}) {
  const qr = useMemo(() => bookingQr(booking), [booking])
  const [svg, setSvg] = useState('')
  const [large, setLarge] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    QRCode.toString(qr.value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg(''))
  }, [qr.value])

  async function share() {
    setError(null)
    try {
      const dataUrl = await QRCode.toDataURL(qr.value, { margin: 2, width: 600, errorCorrectionLevel: 'M' })
      await sharePng(dataUrl, qrFilename(booking.plate, booking.external_ref))
    } catch (e) {
      setError((e as Error).message || 'Teilen fehlgeschlagen')
    }
  }

  const code = (
    <div className="bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
  )

  return (
    <div className="flex items-start gap-4">
      <button type="button" onClick={() => setLarge(true)} aria-label="QR-Code groß anzeigen"
        className="w-28 shrink-0 rounded-lg border border-line">
        {code}
      </button>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm text-subtle">{qr.caption}. Scannen startet die Annahme.</p>
        {booking.external_ref && <p className="break-all font-mono text-sm">{booking.external_ref}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setLarge(true)}>Groß anzeigen</Button>
          <Button onClick={() => void share()}>Teilen</Button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      {large && (
        <Dialog title={`QR-Code ${booking.plate}`} onClose={() => setLarge(false)}>
          <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3">
            {code}
            {booking.external_ref && <p className="font-mono text-lg font-semibold">{booking.external_ref}</p>}
            <p className="text-center text-sm text-muted">{qr.caption}</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}
