import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { QrScanner } from '../components/QrScanner'
import { Button, ErrorList, TextInput } from '../components/ui'
import { isHelperOnly, useAuth } from '../lib/auth'
import { formatPeriod, formatPickup } from '../lib/due'
import { getProtocol } from '../lib/protocols'
import {
  findBookingAt,
  getParkedVehicle,
  hasKeySlot,
  keyHint,
  moveVehicle,
  listHandoverCandidates,
  listScanCandidates,
  parseScan,
  type ParkedVehicle,
} from '../lib/siteplan'
import { findBookingByScan, ticketStep, type ScannedBooking } from '../lib/ticket'

/** Mindestlänge für die Buchungssuche */
const MIN_SEARCH = 2

/** parken = Annahme und Parken (Standard), uebergabe = „Fahrzeug übergeben“ */
type Mode = 'parken' | 'uebergabe'

const handoverPath = (id: string) => `/protokoll/uebergabe/${id}`
/** Übergabezone (Arbeitsort): Fahrzeug zur Abholung bereitstellen */
const HANDOVER_ZONE = 'W-UEB'

/**
 * Zentraler Scan (Bottom-Bar / Kopfzeile):
 *  Parkplatz belegt         → Frage: Fahrzeug übergeben oder umparken
 *  Parkplatz frei           → Parken auf diesem Platz (Fahrzeug zuordnen, bestätigen)
 *  Kunden-QR / Buchungsnr.  → Annahme (Annahmeprotokoll, dann Parken); steht das Fahrzeug schon: Frage wie oben
 * Darunter die Buchungssuche (z. B. Telefonbuchung ohne QR-Code): noch nicht angenommen → Annahme, geparkt → Frage wie oben.
 * /scan?modus=uebergabe: Kunden-QR, Parkplatz-QR und Suche führen direkt ins Übergabeprotokoll.
 */
export function ScanPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const helperOnly = isHelperOnly(profile)
  // Modus steht in der Adresse (/scan?modus=uebergabe), damit Zurück und Lesezeichen passen
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('modus') === 'uebergabe' ? 'uebergabe' : 'parken'
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Übergabe-Modus, Fahrzeug aber noch nicht angenommen: Annahme direkt hier anbieten
  const [intakeOffer, setIntakeOffer] = useState<ScannedBooking | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ParkedVehicle[] | null>(null)
  // Geparktes Fahrzeug gescannt: Übergeben oder Umparken?
  const [vehicle, setVehicle] = useState<ParkedVehicle | null>(null)
  // Umparken: erst Ziel wählen, bei „Anderer Parkplatz“ den neuen Platz scannen
  const [relocate, setRelocate] = useState<'choose' | 'scan' | null>(null)

  const handover = mode === 'uebergabe'

  function switchMode(next: Mode) {
    setParams(next === 'uebergabe' ? { modus: 'uebergabe' } : {}, { replace: true })
    setError(null)
    setNotice(null)
    setVehicle(null)
    setRelocate(null)
    setIntakeOffer(null)
    setSearch('')
    setResults(null)
  }

  // Buchungen suchen: zum Parken noch nicht geparkte, zur Übergabe Fahrzeuge auf dem Gelände
  useEffect(() => {
    const text = search.trim()
    if (text.length < MIN_SEARCH) {
      setResults(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      const load = handover ? listHandoverCandidates(text) : listScanCandidates(text)
      load.then((list) => !cancelled && setResults(list)).catch((e: Error) => !cancelled && setError(e.message))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search, handover])

  /** Treffer zum Parken: Annahmeprotokoll, ist es schon abgeschlossen, weiter zum Parken */
  async function startIntake(b: { id: string }) {
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

  /** Fahrzeug steht auf dem Gelände: im Übergabe-Modus direkt ins Protokoll, sonst fragen */
  async function showVehicle(id: string) {
    if (handover) {
      navigate(handoverPath(id))
      return
    }
    const v = await getParkedVehicle(id)
    if (!v) setError('Buchung nicht gefunden.')
    else setVehicle(v)
  }

  function closeVehicle() {
    setVehicle(null)
    setRelocate(null)
  }

  /** Umparken ausführen; Regeln (belegt, Regal-Reihenfolge) prüft die Datenbank */
  async function relocateTo(code: string, reason: string) {
    if (!vehicle) return
    setBusy(true)
    setError(null)
    try {
      const res = await moveVehicle(vehicle.id, code, reason)
      setNotice([`${vehicle.plate} umgeparkt: ${res.from ?? '–'} → ${res.to ?? '–'}.`, keyHint(res.from, res.to), ...res.warnings]
        .filter(Boolean).join(' '))
      closeVehicle()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onResult(raw: string) {
    if (busy) return
    const scan = parseScan(raw)
    // Umparken: nur der Parkplatz-QR des neuen Platzes zählt
    if (vehicle && relocate === 'scan') {
      if (scan.kind !== 'location' && scan.kind !== 'key') {
        setError('Bitte den QR-Code des neuen Parkplatzes scannen.')
        return
      }
      if (scan.code === vehicle.location_code) {
        setError(`${vehicle.plate} steht bereits auf ${scan.code}.`)
        return
      }
      await relocateTo(scan.code, 'Umparken')
      return
    }
    if (vehicle || intakeOffer) return
    setError(null)
    setNotice(null)
    if (scan.kind === 'unknown') {
      setError(`„${scan.code}“ ist kein Park & Fly QR-Code.`)
      return
    }
    setBusy(true)
    try {
      if (scan.kind === 'ticket' || scan.kind === 'booking_ref' || scan.kind === 'booking_id') {
        const booking = await findBookingByScan(scan.code)
        if (!booking) {
          setError(scan.kind === 'ticket'
            ? 'Zu diesem Kunden-QR-Code gibt es keine Buchung. Bitte über Name, Kennzeichen oder Buchungsnummer suchen.'
            : scan.kind === 'booking_id' ? 'Buchung zu diesem QR-Code nicht gefunden.' : `Buchung ${scan.code} nicht gefunden.`)
          return
        }
        // Übergabe-Modus, aber noch nicht angenommen: gleich hier annehmen statt Scanner wechseln
        if (handover && !booking.intake_final && !booking.has_location && !['cancelled', 'completed'].includes(booking.status)) {
          setIntakeOffer(booking)
          return
        }
        const step = ticketStep(booking, handover ? 'handover' : 'intake')
        if ('error' in step) setError(step.error)
        // Übergabe-Modus, aber schon übergeben bzw. abgeschlossen (Buchungsseite ist für Scanner gesperrt)
        else if (handover && step.path === `/fahrzeuge/${booking.id}`) setError(`${booking.plate} ist bereits übergeben.`)
        // Steht schon auf einem Platz: Übergeben oder Umparken
        else if (!handover && booking.has_location && step.path === `/fahrzeuge/${booking.id}`) await showVehicle(booking.id)
        else navigate(step.path)
        return
      }

      const slot = await findBookingAt(scan.code)
      if (!slot) {
        setError(`Parkplatz ${scan.code} ist unbekannt.`)
      } else if (slot.booking_id) {
        await showVehicle(slot.booking_id)
      } else if (handover) {
        setError(`Auf ${scan.code} steht kein Fahrzeug.`)
      } else if (hasKeySlot(scan.code)) {
        navigate(`/einchecken?platz=${encodeURIComponent(scan.code)}`)
      } else if (!helperOnly) {
        navigate(`/lageplan?platz=${encodeURIComponent(scan.code)}`)
      } else {
        setError(`Auf ${scan.code} steht kein Fahrzeug.`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">{handover ? 'Fahrzeug übergeben' : 'Scannen'}</h1>
      {intakeOffer && (
        <section className="flex flex-col gap-3 rounded-2xl border border-warn bg-warn-soft p-4 text-warn-ink" aria-label="Noch nicht angenommen">
          <div>
            <div className="font-mono text-3xl font-bold">{intakeOffer.plate}</div>
            <p className="mt-1 text-sm">
              ist noch nicht angenommen{intakeOffer.external_ref ? ` (Buchung ${intakeOffer.external_ref})` : ''}. Übergeben geht erst
              nach der Annahme.
            </p>
          </div>
          <Button variant="primary" onClick={() => {
            const step = ticketStep(intakeOffer, 'intake')
            if ('error' in step) setError(step.error)
            else navigate(step.path)
          }}>
            Fahrzeug annehmen
          </Button>
          <button type="button" className="touch-target self-start text-sm underline" onClick={() => setIntakeOffer(null)}>
            Abbrechen, weiter scannen
          </button>
        </section>
      )}

      {!intakeOffer && (!vehicle || relocate === 'scan') && (
        <QrScanner
          onResult={(t) => void onResult(t)}
          label={vehicle ? `Neuen Parkplatz für ${vehicle.plate} scannen` : 'Kunden-QR oder Parkplatz-QR scannen'}
          paused={busy}
          manualInput={false}
        />
      )}
      <ErrorList errors={error ? [error] : []} />
      {notice && <p className="rounded-xl bg-ok-soft px-4 py-2 text-sm text-ok-ink" role="status">{notice}</p>}

      {vehicle && (
        <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label="Fahrzeug gescannt">
          <div>
            <p className="text-xs text-subtle">
              {vehicle.location_code ? `Steht auf ${vehicle.location_code}` : 'Auf dem Gelände'}
            </p>
            <div className="font-mono text-3xl font-bold">{vehicle.plate}</div>
            <div className="text-sm text-subtle">
              {vehicle.customer_name} · Abholung {formatPickup(vehicle.end_at)}
              {vehicle.external_ref ? ` · ${vehicle.external_ref}` : ''}
            </div>
          </div>
          {!relocate && (
            <>
              <p className="text-sm font-semibold">Was möchten Sie tun?</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant="primary" onClick={() => navigate(handoverPath(vehicle.id))}>Fahrzeug übergeben</Button>
                <Button onClick={() => setRelocate('choose')}>Umparken</Button>
              </div>
            </>
          )}
          {relocate === 'choose' && (
            <>
              <p className="text-sm font-semibold">Umparken: wohin?</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button disabled={busy || vehicle.location_code === HANDOVER_ZONE}
                  onClick={() => void relocateTo(HANDOVER_ZONE, 'Übergabe vorbereiten')}>
                  Übergabezone
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => { setError(null); setRelocate('scan') }}>
                  Anderer Parkplatz
                </Button>
              </div>
            </>
          )}
          {relocate === 'scan' && (
            <p className="text-sm">Den QR-Code am <strong>neuen Parkplatz</strong> scannen.</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button type="button" className="touch-target text-subtle underline"
              onClick={() => (relocate ? setRelocate(relocate === 'scan' ? 'choose' : null) : closeVehicle())}>
              {relocate ? 'Zurück' : 'Abbrechen, weiter scannen'}
            </button>
            {!helperOnly && !relocate && (
              <Link className="touch-target inline-flex items-center text-subtle underline" to={`/fahrzeuge/${vehicle.id}`}>
                Zur Buchung
              </Link>
            )}
          </div>
        </section>
      )}

      {!vehicle && !intakeOffer && (
        <section className="flex flex-col gap-2" aria-label="Buchung suchen">
          <h2 className="text-sm font-semibold">
            {handover ? 'Kein QR-Code? Fahrzeug suchen' : 'Kein QR-Code? Buchung suchen'}
          </h2>
          <TextInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, Kennzeichen oder Buchungsnummer"
            aria-label="Buchung suchen nach Name, Kennzeichen oder Buchungsnummer"
            autoComplete="off"
          />
          {results && results.length === 0 && (
            <p className="text-sm text-muted">{handover ? 'Kein Fahrzeug auf dem Gelände gefunden.' : 'Keine passende Buchung gefunden.'}</p>
          )}
          {results && results.length > 0 && (
            <ul className="flex flex-col gap-2">
              {results.map((b) => (
                <li key={b.id}>
                  <button type="button" disabled={busy}
                    onClick={() => {
                      if (handover) navigate(handoverPath(b.id))
                      // steht schon bei uns: Übergeben oder Umparken; sonst Annahme
                      else if (b.location_code) setVehicle(b)
                      else void startIntake(b)
                    }}
                    className="touch-target flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left hover:bg-ground disabled:opacity-60">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{b.customer_name}</span>
                      <span className="block truncate text-sm text-subtle">
                        <span className="font-mono">{b.plate}</span> ·{' '}
                        {b.location_code || handover
                          ? `${b.location_code ?? 'unterwegs'} · Abholung ${formatPickup(b.end_at)}`
                          : formatPeriod(b.start_at, b.end_at)}
                        {b.external_ref ? ` · ${b.external_ref}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-accent">{handover ? 'Übergabe' : b.location_code ? 'Geparkt' : 'Annahme'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Nur-Übergabe-Modus gibt es nur noch über die Adresse /scan?modus=uebergabe (z. B. Lesezeichen am Übergabeplatz) */}
      {!vehicle && !intakeOffer && handover && (
        <Button onClick={() => switchMode('parken')}>Zurück zu Annahme und Parken</Button>
      )}
    </div>
  )
}
