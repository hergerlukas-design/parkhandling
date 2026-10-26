import { useState } from 'react'
import { useNavigate } from 'react-router'
import { QrScanner } from '../components/QrScanner'
import { ErrorList } from '../components/ui'
import { findBookingAt, hasKeySlot, parseScan } from '../lib/siteplan'

/**
 * Zentraler Scan (Bottom-Bar / Kopfzeile):
 *  Stellplatz/Fach belegt  → Fahrzeug (Auschecken, Umsetzen)
 *  Stellplatz/Fach frei    → Einparken auf diesem Platz (Fahrzeug zuordnen, bestätigen)
 *  Arbeits-/Pufferplatz    → Lageplan mit ausgewähltem Platz
 */
export function ScanPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onResult(raw: string) {
    if (busy) return
    const scan = parseScan(raw)
    setError(null)
    if (scan.kind === 'unknown') {
      setError(`„${scan.code}“ ist kein Park & Fly QR-Code.`)
      return
    }
    if (!hasKeySlot(scan.code)) {
      navigate(`/lageplan?platz=${encodeURIComponent(scan.code)}`)
      return
    }
    setBusy(true)
    try {
      const slot = await findBookingAt(scan.code)
      if (!slot) setError(`Stellplatz ${scan.code} ist unbekannt.`)
      else if (slot.booking_id) navigate(`/fahrzeuge/${slot.booking_id}`)
      else navigate(`/einchecken?platz=${encodeURIComponent(scan.code)}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Scannen</h1>
      <QrScanner onResult={(t) => void onResult(t)} label="Stellplatz-QR scannen" paused={busy} />
      <ErrorList errors={error ? [error] : []} />
      <p className="text-sm text-subtle">
        Ein belegter Stellplatz öffnet das Fahrzeug zum Auschecken oder Umsetzen. Ein freier Stellplatz startet das
        Einparken: Fahrzeug zuordnen und bestätigen. Arbeits- und Pufferplätze öffnen den Lageplan.
      </p>
    </div>
  )
}
