import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { usePageTitle } from '../components/usePageTitle'
import { resendConfirmation } from '../lib/api'
import { formatDateLongDE } from '../lib/dates'

interface ThanksState {
  bookingRef?: string
  confirmationSent?: boolean
  arrival?: string
  pickup?: string
  email?: string
}

export function ThanksPage() {
  usePageTitle('Buchung bestätigt')
  const state = (useLocation().state ?? {}) as ThanksState
  const [resent, setResent] = useState<'idle' | 'busy' | 'sent' | 'failed'>('idle')
  const canResend = state.confirmationSent === false && !!state.bookingRef && !!state.email

  async function onResend() {
    if (!state.bookingRef || !state.email) return
    setResent('busy')
    const res = await resendConfirmation(state.bookingRef, state.email)
    setResent(res.ok && res.data.sent ? 'sent' : 'failed')
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-ok/10 text-ok">
        <svg viewBox="0 0 24 24" className="size-9" aria-hidden="true">
          <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="mt-5 text-3xl font-bold">Vielen Dank für Ihre Buchung!</h1>
      <p className="mt-3 text-lg text-ink-soft">
        Die Zahlung ist eingegangen. Ihre Buchung ist angenommen.
        {state.email && (
          <>
            {' '}
            Die Buchungsbestätigung mit allen Angaben, den AGB und der Widerrufsbelehrung geht an <strong className="break-all text-ink">{state.email}</strong>.
          </>
        )}
      </p>
      {state.bookingRef && (
        <p className="mt-4 inline-block rounded-lg bg-card px-4 py-2 text-sm shadow-sm">
          Buchungsnummer: <strong data-testid="booking-ref">{state.bookingRef}</strong>
        </p>
      )}
      {canResend && (
        <div role="alert" className="mx-auto mt-6 max-w-md rounded-xl border border-danger/40 bg-danger/5 p-4 text-left">
          <p className="font-semibold text-danger">Ihre Bestätigung konnte nicht gesendet werden.</p>
          <p className="mt-1 text-sm">Ihre Zahlung ist eingegangen. Der Betrieb wurde informiert. Sie können die Bestätigung hier erneut anfordern.</p>
          {resent === 'idle' && (
            <button type="button" onClick={onResend} className="mt-3 min-h-11 rounded-lg bg-ink px-4 font-semibold text-white">
              Bestätigung erneut senden
            </button>
          )}
          {resent === 'busy' && <p className="mt-3 text-sm">Wird gesendet …</p>}
          {resent === 'sent' && <p className="mt-3 text-sm font-medium text-ok">Die Bestätigung ist unterwegs.</p>}
          {resent === 'failed' && <p className="mt-3 text-sm font-medium text-danger">Auch das hat nicht geklappt. Bitte melden Sie sich bei uns.</p>}
        </div>
      )}
      {state.arrival && state.pickup && (
        <p className="mt-2 block text-sm text-ink-soft">
          Zeitraum: {formatDateLongDE(state.arrival)} bis {formatDateLongDE(state.pickup)}
        </p>
      )}
      <Link
        to="/"
        className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl border border-ink px-6 font-semibold hover:bg-ink hover:text-white"
      >
        Zur Startseite
      </Link>
    </div>
  )
}
