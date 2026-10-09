import { useState } from 'react'
import { useNavigate } from 'react-router'
import { QrScanner } from '../components/QrScanner'
import { ErrorList } from '../components/ui'
import { findBookingAtKeyTag, parseScan } from '../lib/siteplan'

/**
 * Zentraler Scan (Bottom-Bar / Kopfzeile):
 *  Schlüsselanhänger, Platz belegt → Fahrzeug (Auschecken, Umsetzen)
 *  Schlüsselanhänger, Platz frei   → Lageplan mit ausgewähltem Platz
 *  Stellplatz                      → Lageplan mit ausgewähltem Platz
 */
export function ScanPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onResult(raw: string) {
    if (busy) return
    const scan = parseScan(raw)
    setError(null)
    if (scan.kind === 'location') {
      navigate(`/lageplan?platz=${encodeURIComponent(scan.code)}`)
      return
    }
    if (scan.kind === 'key') {
      setBusy(true)
      try {
        const slot = await findBookingAtKeyTag(scan.code)
        if (!slot) setError(`Stellplatz ${scan.code} ist unbekannt.`)
        else if (slot.booking_id) navigate(`/fahrzeuge/${slot.booking_id}`)
        else navigate(`/lageplan?platz=${encodeURIComponent(scan.code)}`)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
      return
    }
    setError(`„${scan.code}“ ist kein Park & Fly QR-Code.`)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Scannen</h1>
      <QrScanner onResult={(t) => void onResult(t)} label="Schlüssel- oder Stellplatz-QR scannen" paused={busy} />
      <ErrorList errors={error ? [error] : []} />
      <p className="text-sm text-subtle">
        Ein Schlüsselanhänger öffnet das Fahrzeug auf diesem Stellplatz zum Auschecken oder Umsetzen. Ist der Platz frei,
        oder wird ein Stellplatz-Code gescannt, öffnet sich der Lageplan.
      </p>
    </div>
  )
}
