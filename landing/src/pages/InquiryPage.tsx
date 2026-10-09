import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { usePageTitle } from '../components/usePageTitle'
import { submitInquiry } from '../lib/api'
import { addDays, daysBetween, formatDateLongDE, isIsoDate, todayInBerlin } from '../lib/dates'
import {
  EMPTY_FORM,
  FIELD_ORDER,
  type InquiryErrors,
  type InquiryForm,
  isParkingType,
  LIMITS,
  MAX_ADVANCE_DAYS,
  PARKING_OPTIONS,
  type Service,
  SERVICE_OPTIONS,
  validateInquiry,
} from '../lib/inquiry'
import { readAttribution } from '../lib/utm'

const inputClass =
  'block h-12 w-full min-w-0 rounded-lg border bg-white px-3 text-base text-ink placeholder:text-ink-soft/60 aria-[invalid=true]:border-danger border-line focus:border-ink'

function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: keyof InquiryForm
  label: string
  hint?: ReactNode
  error?: string
  optional?: boolean
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
        {optional && <span className="font-normal text-ink-soft"> (optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded-2xl border border-line bg-card p-4 shadow-sm md:p-6">
      <legend className="float-left mb-4 w-full text-lg font-semibold">{title}</legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  )
}

export function InquiryPage() {
  usePageTitle('Anfrage')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preset = params.get('stellplatz')
  const today = todayInBerlin()

  const [form, setForm] = useState<InquiryForm>(() => ({
    ...EMPTY_FORM,
    parking_type: isParkingType(preset) ? preset : '',
  }))
  const [errors, setErrors] = useState<InquiryErrors>({})
  const [submitted, setSubmitted] = useState(false)
  const [sending, setSending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [honeypot, setHoneypot] = useState('')
  const openedAt = useRef(performance.now())
  const summaryRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof InquiryForm>(key: K, value: InquiryForm[K]) => {
    const next = { ...form, [key]: value }
    setForm(next)
    // Nach dem ersten Absendeversuch live nachprüfen, damit Fehler beim Korrigieren verschwinden
    if (submitted) setErrors(validateInquiry(next, today))
  }

  const toggleService = (s: Service) =>
    set('services', form.services.includes(s) ? form.services.filter((x) => x !== s) : [...form.services, s])

  const nights = useMemo(
    () =>
      isIsoDate(form.arrival_date) && isIsoDate(form.pickup_date) && form.pickup_date > form.arrival_date
        ? daysBetween(form.arrival_date, form.pickup_date)
        : null,
    [form.arrival_date, form.pickup_date],
  )

  const a11y = (key: keyof InquiryForm, withHint = false) => ({
    id: key,
    name: key,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : withHint ? `${key}-hint` : undefined,
  })

  const focusFirstError = (errs: InquiryErrors) => {
    const first = FIELD_ORDER.find((k) => errs[k])
    if (!first) return
    const el = document.getElementById(first) ?? document.querySelector<HTMLElement>(`[name="${first}"]`)
    el?.focus()
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setServerError(null)
    const errs = validateInquiry(form, today)
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      focusFirstError(errs)
      return
    }

    setSending(true)
    const { utm, referrer } = readAttribution()
    const result = await submitInquiry({
      ...form,
      plate: form.plate.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      message: form.message.trim(),
      website: honeypot,
      form_duration_ms: Math.round(performance.now() - openedAt.current),
      utm,
      referrer,
    })
    setSending(false)

    if (result.ok) {
      navigate('/danke', {
        replace: true,
        state: { arrival: form.arrival_date, pickup: form.pickup_date, email: form.email.trim() },
      })
      return
    }
    setServerError(result.message)
    if (result.fields) {
      setErrors(result.fields)
      focusFirstError(result.fields)
    } else {
      summaryRef.current?.focus()
    }
  }

  const errorCount = Object.keys(errors).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold">Unverbindlich anfragen</h1>
      <p className="mt-2 text-ink-soft">
        Wir prüfen die Verfügbarkeit und melden uns per E-Mail mit einem Angebot. Die Anfrage ist noch keine Buchung.
      </p>

      <div ref={summaryRef} tabIndex={-1} className="outline-none" aria-live="assertive">
        {(serverError || (submitted && errorCount > 0)) && (
          <div role="alert" className="mt-5 rounded-xl border border-danger/40 bg-danger/5 p-4 text-danger">
            <p className="font-semibold">{serverError ?? 'Bitte die markierten Felder prüfen.'}</p>
            {!serverError && errorCount > 1 && <p className="text-sm">{errorCount} Angaben fehlen oder sind ungültig.</p>}
          </div>
        )}
      </div>

      <form noValidate onSubmit={onSubmit} className="mt-6 space-y-5">
        <Section title="Reisezeitraum">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="arrival_date"
              label="Anreise"
              error={errors.arrival_date}
              hint={form.arrival_date ? formatDateLongDE(form.arrival_date) : 'Datum, an dem Sie Ihr Fahrzeug abgeben'}
            >
              <input
                type="date"
                {...a11y('arrival_date', true)}
                className={inputClass}
                min={today}
                max={addDays(today, MAX_ADVANCE_DAYS)}
                value={form.arrival_date}
                onChange={(e) => set('arrival_date', e.target.value)}
              />
            </Field>
            <Field
              id="pickup_date"
              label="Abholung"
              error={errors.pickup_date}
              hint={form.pickup_date ? formatDateLongDE(form.pickup_date) : 'Datum, an dem Sie zurück sind'}
            >
              <input
                type="date"
                {...a11y('pickup_date', true)}
                className={inputClass}
                min={isIsoDate(form.arrival_date) ? addDays(form.arrival_date, 1) : addDays(today, 1)}
                value={form.pickup_date}
                onChange={(e) => set('pickup_date', e.target.value)}
              />
            </Field>
          </div>
          {nights !== null && (
            <p className="rounded-lg bg-paper px-3 py-2 text-sm" data-testid="duration">
              {formatDateLongDE(form.arrival_date)} bis {formatDateLongDE(form.pickup_date)} ·{' '}
              <strong>
                {nights} {nights === 1 ? 'Tag' : 'Tage'}
              </strong>
            </p>
          )}
        </Section>

        <Section title="Stellplatz">
          <div role="radiogroup" aria-label="Stellplatzart" aria-describedby={errors.parking_type ? 'parking_type-error' : undefined} className="grid gap-2 sm:grid-cols-2">
            {PARKING_OPTIONS.map((o, i) => (
              <label
                key={o.value}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 has-checked:border-ink has-checked:bg-paper has-checked:ring-1 has-checked:ring-ink"
              >
                <input
                  type="radio"
                  name="parking_type"
                  id={i === 0 ? 'parking_type' : undefined}
                  value={o.value}
                  checked={form.parking_type === o.value}
                  onChange={() => set('parking_type', o.value)}
                  className="size-5 accent-ink"
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          {errors.parking_type && (
            <p id="parking_type-error" className="text-sm font-medium text-danger">
              {errors.parking_type}
            </p>
          )}
          <p className="text-sm text-ink-soft">Preise auf Anfrage, je nach Zeitraum und Stellplatz.</p>
        </Section>

        <Section title="Fahrzeug und Kontakt">
          <Field id="plate" label="Kennzeichen" error={errors.plate}>
            <input
              type="text"
              {...a11y('plate')}
              className={`${inputClass} uppercase`}
              maxLength={LIMITS.plate}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="z. B. M-AB 1234"
              value={form.plate}
              onChange={(e) => set('plate', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="first_name" label="Vorname" error={errors.first_name}>
              <input
                type="text"
                {...a11y('first_name')}
                className={inputClass}
                maxLength={LIMITS.name}
                autoComplete="given-name"
                value={form.first_name}
                onChange={(e) => set('first_name', e.target.value)}
              />
            </Field>
            <Field id="last_name" label="Nachname" error={errors.last_name}>
              <input
                type="text"
                {...a11y('last_name')}
                className={inputClass}
                maxLength={LIMITS.name}
                autoComplete="family-name"
                value={form.last_name}
                onChange={(e) => set('last_name', e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="email" label="E-Mail" error={errors.email}>
              <input
                type="email"
                {...a11y('email')}
                className={inputClass}
                maxLength={LIMITS.email}
                autoComplete="email"
                inputMode="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>
            <Field id="phone" label="Telefon" optional error={errors.phone}>
              <input
                type="tel"
                {...a11y('phone')}
                className={inputClass}
                maxLength={LIMITS.phone}
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Zusatzleistungen">
          <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Zusatzleistungen (optional)">
            {SERVICE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 has-checked:border-ink has-checked:bg-paper"
              >
                <input
                  type="checkbox"
                  name="services"
                  value={o.value}
                  checked={form.services.includes(o.value)}
                  onChange={() => toggleService(o.value)}
                  className="size-5 accent-ink"
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          <Field
            id="message"
            label="Nachricht"
            optional
            error={errors.message}
            hint={`${form.message.length} / ${LIMITS.message} Zeichen`}
          >
            <textarea
              {...a11y('message', true)}
              rows={4}
              maxLength={LIMITS.message}
              className="block w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-base aria-[invalid=true]:border-danger focus:border-ink"
              placeholder="z. B. Flugnummer, Uhrzeit, Anzahl Personen im Shuttle"
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
            />
          </Field>
        </Section>

        {/* Honeypot: für Menschen unsichtbar, Bots füllen es aus */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
          <label htmlFor="website">Website (bitte leer lassen)</label>
          <input
            type="text"
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-line bg-card p-4 shadow-sm md:p-6">
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              {...a11y('consent_privacy')}
              checked={form.consent_privacy}
              onChange={(e) => set('consent_privacy', e.target.checked)}
              className="mt-0.5 size-6 shrink-0 accent-ink"
            />
            <span>
              Ich habe den{' '}
              <Link to="/datenschutz" target="_blank" className="font-medium underline">
                Datenschutzhinweis
              </Link>{' '}
              gelesen. Meine Angaben werden nur zur Bearbeitung dieser Anfrage verwendet.
            </span>
          </label>
          {errors.consent_privacy && (
            <p id="consent_privacy-error" className="mt-1 text-sm font-medium text-danger">
              {errors.consent_privacy}
            </p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-ink px-6 text-base font-semibold text-white hover:bg-ink-soft disabled:opacity-60 sm:w-auto"
          >
            {sending ? 'Wird gesendet …' : 'Anfrage senden'}
          </button>
          <p className="mt-2 text-sm text-ink-soft">Unverbindlich und kostenlos. Antwort per E-Mail.</p>
        </div>
      </form>
    </div>
  )
}
