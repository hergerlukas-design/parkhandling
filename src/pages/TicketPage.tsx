import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ErrorList } from '../components/ui'
import { findBookingByScan, ticketStep } from '../lib/ticket'

/**
 * Einstieg von der Mitarbeiterseite des Rechners (ticket.html bei CarHandling):
 *  /annahme#<Ticket-Code>   → Annahmeprotokoll, danach Einchecken
 *  /rueckgabe#<Ticket-Code> → Übergabeprotokoll
 * Der Code steht hinter #, damit er nicht in Server-Logs landet.
 */
export function TicketPage({ mode }: { mode: 'intake' | 'handover' }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [fallback, setFallback] = useState<string | null>(null)

  useEffect(() => {
    const code = window.location.hash.slice(1).trim()
    if (!/^[0-9a-f]{32}$/i.test(code)) {
      setError('Kein gültiger Ticket-Code im Link.')
      return
    }
    let cancelled = false
    findBookingByScan(code)
      .then((booking) => {
        if (cancelled) return
        if (!booking) {
          setError('Zu diesem Ticket gibt es (noch) keine Buchung im Dashboard. Ist die Buchung bezahlt?')
          return
        }
        const step = ticketStep(booking, mode)
        if ('error' in step) {
          setError(step.error)
          setFallback(step.path ?? null)
        } else navigate(step.path, { replace: true })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [mode, navigate])

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">{mode === 'intake' ? 'Annahme' : 'Rückgabe'}</h1>
      {!error && <p className="text-sm text-subtle">Buchung wird gesucht …</p>}
      <ErrorList errors={error ? [error] : []} />
      {error && (
        <div className="flex flex-wrap gap-3 text-sm">
          {fallback && <Link className="underline" to={fallback}>Zum Fahrzeug</Link>}
          <Link className="underline" to="/scan">Scannen</Link>
          <Link className="underline" to="/einchecken">Einchecken</Link>
        </div>
      )}
    </div>
  )
}
