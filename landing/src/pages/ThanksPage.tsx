import { Link, useLocation } from 'react-router'
import { usePageTitle } from '../components/usePageTitle'
import { formatDateLongDE } from '../lib/dates'

interface ThanksState {
  arrival?: string
  pickup?: string
  email?: string
}

export function ThanksPage() {
  usePageTitle('Vielen Dank')
  const state = (useLocation().state ?? {}) as ThanksState

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-ok/10 text-ok">
        <svg viewBox="0 0 24 24" className="size-9" aria-hidden="true">
          <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="mt-5 text-3xl font-bold">Vielen Dank für Ihre Anfrage!</h1>
      <p className="mt-3 text-lg text-ink-soft">
        Ihre Anfrage ist bei uns eingegangen. Wir prüfen die Verfügbarkeit und melden uns
        {state.email ? (
          <>
            {' '}
            per E-Mail an <strong className="break-all text-ink">{state.email}</strong>
          </>
        ) : (
          ' per E-Mail'
        )}{' '}
        mit einem Angebot.
      </p>
      {state.arrival && state.pickup && (
        <p className="mt-4 inline-block rounded-lg bg-card px-4 py-2 text-sm shadow-sm">
          Zeitraum: {formatDateLongDE(state.arrival)} bis {formatDateLongDE(state.pickup)}
        </p>
      )}
      <p className="mt-4 text-sm text-ink-soft">
        Ihre Anfrage ist unverbindlich und noch keine Buchung. Gebucht wird erst mit Ihrer Bestätigung.
      </p>
      <Link
        to="/"
        className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl border border-ink px-6 font-semibold hover:bg-ink hover:text-white"
      >
        Zur Startseite
      </Link>
    </div>
  )
}
