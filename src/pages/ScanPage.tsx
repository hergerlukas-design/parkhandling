import { useState } from 'react'
import { useNavigate } from 'react-router'
import { QrScanner } from '../components/QrScanner'
import { ErrorList } from '../components/ui'
import { findBookingByKey, parseScan } from '../lib/siteplan'

/**
 * Zentraler Scan (Bottom-Bar / Kopfzeile):
 *  Schlüssel frei      → Einchecken mit diesem Schlüssel
 *  Schlüssel belegt    → Fahrzeug (Auschecken, Umsetzen)
 *  Stellplatz          → Lageplan mit ausgewähltem Platz
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
        const key = await findBookingByKey(scan.code)
        if (!key) setError(`Schlüsselfach ${scan.code} ist unbekannt.`)
        else if (key.booking_id) navigate(`/fahrzeuge/${key.booking_id}`)
        else navigate(`/einchecken?key=${encodeURIComponent(scan.code)}`)
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
        Schlüssel ohne Fahrzeug startet das Einchecken. Schlüssel mit Fahrzeug öffnet das Fahrzeug zum Auschecken oder
        Umsetzen. Stellplatz-Codes öffnen den Lageplan.
      </p>
    </div>
  )
}
