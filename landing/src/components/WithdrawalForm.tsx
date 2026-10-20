import { useState } from 'react'
import { type FieldErrors, type WithdrawalForm as Form, submitWithdrawal } from '../lib/api'

const EMPTY: Form = { booking_ref: '', email: '', name: '', reason: '', consent_withdraw: false, website: '' }
const inputClass =
  'block h-12 w-full min-w-0 rounded-lg border bg-white px-3 text-base text-ink placeholder:text-ink-soft/60 aria-[invalid=true]:border-danger border-line focus:border-ink'

function formatReceipt(iso: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  return `${date}, ${time} Uhr`
}

export function WithdrawalForm() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<{ received_at: string; email: string; ref: string } | null>(null)

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setServerError(null)
    const res = await submitWithdrawal(form)
    setBusy(false)
    if (!res.ok) {
      setErrors(res.fields ?? {})
      setServerError(res.message)
      return
    }
    setReceipt({ received_at: res.data.received_at, email: form.email.trim(), ref: res.data.booking_ref })
  }

  if (receipt) {
    return (
      <section className="mt-8 rounded-2xl border border-ok/40 bg-ok/5 p-5" aria-live="polite">
        <h2 className="text-lg font-semibold">Ihr Widerruf ist eingegangen</h2>
        <p className="mt-2">
          Eingegangen am <strong>{formatReceipt(receipt.received_at)}</strong> (Berliner Zeit) zur Buchung{' '}
          <strong>{receipt.ref}</strong>. Die Eingangsbestätigung haben wir an{' '}
          <strong className="break-all">{receipt.email}</strong> gesendet.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-card p-5 shadow-sm" aria-labelledby="widerruf-online">
      <h2 id="widerruf-online" className="text-lg font-semibold">
        Widerruf online erklären
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Geben Sie Buchungsnummer und die E-Mail-Adresse an, mit der Sie gebucht haben. Sie erhalten sofort eine
        Eingangsbestätigung per E-Mail.
      </p>

      {serverError && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/5 p-3 font-medium text-danger">
          {serverError}
        </p>
      )}

      <form noValidate onSubmit={onSubmit} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="w-ref" className="mb-1 block font-medium">
              Buchungsnummer
            </label>
            <input
              id="w-ref"
              name="booking_ref"
              type="text"
              className={inputClass}
              placeholder="PF-XXXXXXXX"
              maxLength={11}
              autoCapitalize="characters"
              autoComplete="off"
              aria-invalid={errors.booking_ref ? true : undefined}
              value={form.booking_ref}
              onChange={(e) => set('booking_ref', e.target.value)}
            />
            {errors.booking_ref && <p className="mt-1 text-sm font-medium text-danger">{errors.booking_ref}</p>}
          </div>
          <div>
            <label htmlFor="w-email" className="mb-1 block font-medium">
              E-Mail der Buchung
            </label>
            <input
              id="w-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className={inputClass}
              maxLength={254}
              aria-invalid={errors.email ? true : undefined}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
            {errors.email && <p className="mt-1 text-sm font-medium text-danger">{errors.email}</p>}
          </div>
          <div>
            <label htmlFor="w-name" className="mb-1 block font-medium">
              Vor- und Nachname
            </label>
            <input
              id="w-name"
              name="name"
              type="text"
              autoComplete="name"
              className={inputClass}
              maxLength={100}
              aria-invalid={errors.name ? true : undefined}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            {errors.name && <p className="mt-1 text-sm font-medium text-danger">{errors.name}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="w-reason" className="mb-1 block font-medium">
            Hinweis <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <textarea
            id="w-reason"
            name="reason"
            rows={3}
            maxLength={500}
            className="block w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-base focus:border-ink"
            value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
          {errors.reason && <p className="mt-1 text-sm font-medium text-danger">{errors.reason}</p>}
        </div>

        {/* Honeypot: für Menschen unsichtbar */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
          <label htmlFor="w-website">Website (bitte leer lassen)</label>
          <input id="w-website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
        </div>

        <div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              id="consent_withdraw"
              name="consent_withdraw"
              className="mt-0.5 size-6 shrink-0 accent-ink"
              checked={form.consent_withdraw}
              aria-invalid={errors.consent_withdraw ? true : undefined}
              onChange={(e) => set('consent_withdraw', e.target.checked)}
            />
            <span>Ich widerrufe hiermit den Vertrag über meine oben genannte Buchung.</span>
          </label>
          {errors.consent_withdraw && <p className="mt-1 text-sm font-medium text-danger">{errors.consent_withdraw}</p>}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-ink px-6 font-semibold text-white hover:bg-ink-soft disabled:opacity-60 sm:w-auto"
        >
          {busy ? 'Wird gesendet …' : 'Widerruf absenden'}
        </button>
      </form>
    </section>
  )
}
