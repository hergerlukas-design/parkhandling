import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { QrScanner } from '../components/QrScanner'
import { ErrorList, TextInput } from '../components/ui'
import { formatPeriod } from '../lib/due'
import { getProtocol } from '../lib/protocols'
import { findBookingAt, hasKeySlot, listCheckinCandidates, parseScan, type CheckinCandidate } from '../lib/siteplan'
import { findBookingByScan, ticketStep } from '../lib/ticket'

/** Mindestlänge für die Buchungssuche */
const MIN_SEARCH = 2

/**
 * Zentraler Scan (Bottom-Bar / Kopfzeile):
 *  Stellplatz/Fach belegt  → Fahrzeug (Auschecken, Umsetzen)
 *  Stellplatz/Fach frei    → Einparken auf diesem Platz (Fahrzeug zuordnen, bestätigen)
 *  Arbeits-/Pufferplatz    → Lageplan mit ausgewähltem Platz
 *  Kunden-QR / Buchungsnr.  → Annahme (Annahmeprotokoll, dann Einchecken) bzw. Fahrzeug
 * Darunter die Suche nach Name, Kennzeichen oder Buchungsnummer (z. B. Telefonbuchung ohne QR-Code):
 * ein Treffer startet ebenfalls die Annahme.
 */
export function ScanPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<CheckinCandidate[] | null>(null)

  // Buchungen suchen, die noch angenommen bzw. eingeparkt werden können
  useEffect(() => {
    const text = search.trim()
    if (text.length < MIN_SEARCH) {
      setResults(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      listCheckinCandidates(text)
        .then((list) => !cancelled && setResults(list))
        .catch((e: Error) => !cancelled && setError(e.message))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search])

  /** Treffer gewählt: Annahmeprotokoll, ist es schon abgeschlossen, weiter zum Einparken */
  async function startIntake(b: CheckinCandidate) {
    setBusy(true)
    setError(null)
    try {
      const intake = await getProtocol(b.id, 'intake')
      navigate(intake?.status === 'final' ? `/einchecken?booking=${b.id}` : `/protokoll/annahme/${b.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function onResult(raw: string) {
    if (busy) return
    const scan = parseScan(raw)
    setError(null)
    if (scan.kind === 'unknown') {
      setError(`„${scan.code}“ ist kein Park & Fly QR-Code.`)
      return
    }
    if (scan.kind === 'ticket' || scan.kind === 'booking_ref') {
      setBusy(true)
      try {
        const booking = await findBookingByScan(scan.code)
        if (!booking) {
          setError(scan.kind === 'ticket'
            ? 'Zu diesem Kunden-QR-Code gibt es keine Buchung. Bitte über die Buchungsnummer oder das Kennzeichen suchen.'
            : `Buchung ${scan.code} nicht gefunden.`)
          return
        }
        const step = ticketStep(booking, 'intake')
        if ('error' in step) setError(step.error)
        else navigate(step.path)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
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
      <QrScanner onResult={(t) => void onResult(t)} label="Kunden-QR-Code scannen" paused={busy} manualInput={false} />
      <ErrorList errors={error ? [error] : []} />

      <section className="flex flex-col gap-2" aria-label="Buchung suchen">
        <h2 className="text-sm font-semibold">Kein QR-Code? Buchung suchen</h2>
        <TextInput
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, Kennzeichen oder Buchungsnummer"
          aria-label="Buchung suchen nach Name, Kennzeichen oder Buchungsnummer"
          autoComplete="off"
        />
        {results && results.length === 0 && (
          <p className="text-sm text-muted">Keine offene Buchung gefunden.</p>
        )}
        {results && results.length > 0 && (
          <ul className="flex flex-col gap-2">
            {results.map((b) => (
              <li key={b.id}>
                <button type="button" disabled={busy} onClick={() => void startIntake(b)}
                  className="touch-target flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left hover:bg-ground disabled:opacity-60">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{b.customer_name}</span>
                    <span className="block truncate text-sm text-subtle">
                      <span className="font-mono">{b.plate}</span> · {formatPeriod(b.start_at, b.end_at)}
                      {b.external_ref ? ` · ${b.external_ref}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-accent">Annahme</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
