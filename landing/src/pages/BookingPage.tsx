import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { usePageTitle } from '../components/usePageTitle'
import { type FieldErrors, type Tariff, captureCheckout, createCheckout, fetchTariffs } from '../lib/api'
import {
  EMPTY_FORM,
  FIELD_ORDER,
  FUEL_OPTIONS,
  type BookingForm,
  MAX_DAYS,
  MIN_DAYS,
  RETURN_OPTIONS,
  type PriceTier,
  TIER_LABEL,
  formatEuro,
  rentalDays,
  tierForDays,
} from '../lib/booking'
import { addDays, formatDateLongDE, todayInBerlin } from '../lib/dates'
import { loadPayPal, paypalClientId, type PayPalNamespace } from '../lib/paypal'

const inputClass =
  'block h-12 w-full min-w-0 rounded-lg border bg-white px-3 text-base text-ink placeholder:text-ink-soft/60 aria-[invalid=true]:border-danger border-line focus:border-ink'

const MAX_ADVANCE_DAYS = 365

type Errors = FieldErrors

function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: keyof BookingForm
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

function priceForTier(t: Tariff, tier: PriceTier): number {
  return tier === 'week' ? t.price_week : tier === 'holiday' ? t.price_holiday : t.price_month
}

export function BookingPage() {
  usePageTitle('Jetzt buchen')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const presetTariff = params.get('tarif')
  const today = todayInBerlin()

  const [form, setForm] = useState<BookingForm>(() => ({ ...EMPTY_FORM, tariff_code: presetTariff ?? '' }))
  const formRef = useRef(form)
  formRef.current = form
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [tariffs, setTariffs] = useState<Tariff[] | null>(null)
  const [tariffError, setTariffError] = useState<string | null>(null)
  const [paypalState, setPaypalState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const checkoutRef = useRef<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const paypalRef = useRef<HTMLDivElement>(null)
  const clientId = paypalClientId()

  useEffect(() => {
    fetchTariffs()
      .then(setTariffs)
      .catch((err: unknown) => setTariffError(err instanceof Error ? err.message : 'Tarife konnten nicht geladen werden.'))
  }, [])

  // PayPal-Buttons einmal rendern. createOrder und onApprove lesen das aktuelle Formular über formRef.
  useEffect(() => {
    if (!clientId || !tariffs || !paypalRef.current || paypalRef.current.childElementCount > 0) return
    let cancelled = false
    setPaypalState('loading')
    loadPayPal(clientId)
      .then((paypal: PayPalNamespace) => {
        if (cancelled || !paypalRef.current) return
        return paypal
          .Buttons({
            style: { layout: 'vertical', shape: 'rect', height: 48, label: 'pay' },
            createOrder: async () => {
              setServerError(null)
              const res = await createCheckout(formRef.current)
              if (!res.ok) {
                setSubmitted(true)
                setErrors(res.fields ?? {})
                setServerError(res.message)
                if (res.fields) focusFirst(res.fields)
                else summaryRef.current?.focus()
                throw new Error(res.message)
              }
              checkoutRef.current = res.data.checkout_id
              return res.data.paypal_order_id
            },
            onApprove: async (data) => {
              const checkoutId = checkoutRef.current
              if (!checkoutId) throw new Error('Keine Bestellung')
              const res = await captureCheckout(checkoutId, data.orderID)
              if (!res.ok) {
                setServerError(res.message)
                summaryRef.current?.focus()
                return
              }
              const f = formRef.current
              navigate('/danke', {
                replace: true,
                state: {
                  bookingRef: res.data.booking_ref,
                  arrival: f.arrival_date,
                  pickup: f.pickup_date,
                  email: f.email.trim(),
                },
              })
            },
            onError: () => {
              setServerError((prev) => prev ?? 'Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.')
            },
          })
          .render(paypalRef.current)
          .then(() => !cancelled && setPaypalState('ready'))
      })
      .catch(() => !cancelled && setPaypalState('unavailable'))
    return () => {
      cancelled = true
    }
  }, [clientId, tariffs, navigate])

  const days = useMemo(() => rentalDays(form), [form.arrival_date, form.pickup_date])
  const tier = days !== null ? tierForDays(days) : null
  const selectedTariff = tariffs?.find((t) => t.code === form.tariff_code) ?? null

  const set = <K extends keyof BookingForm>(key: K, value: BookingForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (submitted) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const a11y = (key: keyof BookingForm, withHint = false) => ({
    id: key,
    name: key,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : withHint ? `${key}-hint` : undefined,
  })

  function focusFirst(errs: Errors) {
    const first = FIELD_ORDER.find((k) => errs[k])
    if (!first) return
    const el = document.getElementById(first) ?? document.querySelector<HTMLElement>(`[name="${first}"]`)
    el?.focus()
  }

  const errorCount = Object.keys(errors).filter((k) => errors[k as keyof BookingForm]).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold">Jetzt buchen</h1>
      <p className="mt-2 text-ink-soft">
        Zeitraum und Tarif wählen, Daten eingeben und mit PayPal bezahlen. Nach der Zahlung ist Ihre Buchung bestätigt.
      </p>

      <div ref={summaryRef} tabIndex={-1} className="outline-none" aria-live="assertive">
        {(serverError || (submitted && errorCount > 0)) && (
          <div role="alert" className="mt-5 rounded-xl border border-danger/40 bg-danger/5 p-4 text-danger">
            <p className="font-semibold">{serverError ?? 'Bitte die markierten Felder prüfen.'}</p>
            {!serverError && errorCount > 1 && <p className="text-sm">{errorCount} Angaben fehlen oder sind ungültig.</p>}
          </div>
        )}
      </div>

      <form noValidate onSubmit={(e) => e.preventDefault()} className="mt-6 space-y-5">
        <Section title="Reisezeitraum">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="arrival_date"
              label="Anreise"
              error={errors.arrival_date}
              hint={form.arrival_date ? formatDateLongDE(form.arrival_date) : 'Tag der Abgabe am Flughafen'}
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
            <Field id="arrival_time" label="Uhrzeit Anreise" error={errors.arrival_time}>
              <input
                type="time"
                {...a11y('arrival_time')}
                className={inputClass}
                value={form.arrival_time}
                onChange={(e) => set('arrival_time', e.target.value)}
              />
            </Field>
            <Field
              id="pickup_date"
              label="Abholung"
              error={errors.pickup_date}
              hint={form.pickup_date ? formatDateLongDE(form.pickup_date) : 'Tag der Rückkehr'}
            >
              <input
                type="date"
                {...a11y('pickup_date', true)}
                className={inputClass}
                min={form.arrival_date ? addDays(form.arrival_date, 1) : addDays(today, 1)}
                value={form.pickup_date}
                onChange={(e) => set('pickup_date', e.target.value)}
              />
            </Field>
            <Field id="pickup_time" label="Uhrzeit Abholung" error={errors.pickup_time}>
              <input
                type="time"
                {...a11y('pickup_time')}
                className={inputClass}
                value={form.pickup_time}
                onChange={(e) => set('pickup_time', e.target.value)}
              />
            </Field>
          </div>
          {days !== null && (
            <p className="rounded-lg bg-paper px-3 py-2 text-sm" data-testid="duration">
              {formatDateLongDE(form.arrival_date)} bis {formatDateLongDE(form.pickup_date)} ·{' '}
              <strong>
                {days} {days === 1 ? 'Tag' : 'Tage'}
              </strong>
            </p>
          )}
          {days !== null && (days < MIN_DAYS || days > MAX_DAYS) && (
            <p className="text-sm font-medium text-danger">
              {days < MIN_DAYS
                ? `Online buchbar ab ${MIN_DAYS} Tagen. Bei kürzerer Dauer bitte direkt bei uns anfragen.`
                : `Der Monatstarif gilt höchstens ${MAX_DAYS} Tage. Bei längerer Dauer bitte direkt bei uns anfragen.`}
            </p>
          )}
        </Section>

        <Section title="Tarif">
          {tariffError && <p className="text-sm font-medium text-danger">{tariffError}</p>}
          {!tariffs && !tariffError && <p className="text-sm text-ink-soft">Tarife werden geladen …</p>}
          {tariffs && (
            <div role="radiogroup" aria-label="Tarif" aria-describedby={errors.tariff_code ? 'tariff_code-error' : undefined} className="grid gap-3 md:grid-cols-2">
              {tariffs.map((t, i) => (
                <label
                  key={t.code}
                  className="flex min-h-12 cursor-pointer flex-col gap-2 rounded-xl border border-line bg-white p-4 has-checked:border-ink has-checked:bg-paper has-checked:ring-1 has-checked:ring-ink"
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="tariff_code"
                      id={i === 0 ? 'tariff_code' : undefined}
                      value={t.code}
                      checked={form.tariff_code === t.code}
                      onChange={() => set('tariff_code', t.code)}
                      className="mt-1 size-5 accent-ink"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold">{t.label}</span>
                      <span className="block text-sm text-ink-soft">{t.shuttle_text} Shuttle zum Terminal</span>
                    </span>
                  </span>
                  <span className="text-sm text-ink-soft">{t.included_text}</span>
                  <span className="text-sm" data-testid={`price-${t.code}`}>
                    {tier ? (
                      <strong>{formatEuro(priceForTier(t, tier))} </strong>
                    ) : (
                      <span>
                        {formatEuro(t.price_week)} (5–8 Tage) · {formatEuro(t.price_holiday)} (9–15) ·{' '}
                        {formatEuro(t.price_month)} (16–30)
                      </span>
                    )}
                    {tier && <span className="text-ink-soft">{TIER_LABEL[tier]}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          {errors.tariff_code && (
            <p id="tariff_code-error" className="text-sm font-medium text-danger">
              {errors.tariff_code}
            </p>
          )}
          {selectedTariff && tier && (
            <p className="rounded-lg bg-paper px-3 py-2 text-sm" data-testid="total">
              Gesamtpreis: <strong>{formatEuro(priceForTier(selectedTariff, tier))}</strong>
            </p>
          )}
        </Section>

        <Section title="Fahrzeug">
          <Field id="plate" label="Kennzeichen" error={errors.plate}>
            <input
              type="text"
              {...a11y('plate')}
              className={`${inputClass} uppercase`}
              maxLength={15}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="z. B. M-AB 1234"
              value={form.plate}
              onChange={(e) => set('plate', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="vehicle_model" label="Fahrzeug" optional error={errors.vehicle_model}>
              <input
                type="text"
                {...a11y('vehicle_model')}
                className={inputClass}
                maxLength={60}
                placeholder="z. B. BMW 320d"
                value={form.vehicle_model}
                onChange={(e) => set('vehicle_model', e.target.value)}
              />
            </Field>
            <Field id="fuel_type" label="Antrieb" optional error={errors.fuel_type}>
              <select {...a11y('fuel_type')} className={inputClass} value={form.fuel_type} onChange={(e) => set('fuel_type', e.target.value)}>
                <option value="">–</option>
                {FUEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="persons" label="Personen" error={errors.persons}>
              <input
                type="number"
                {...a11y('persons')}
                className={inputClass}
                min={1}
                max={50}
                inputMode="numeric"
                value={form.persons}
                onChange={(e) => set('persons', e.target.value)}
              />
            </Field>
            <Field id="return_mode" label="Rückgabe" error={errors.return_mode}>
              <select {...a11y('return_mode')} className={inputClass} value={form.return_mode} onChange={(e) => set('return_mode', e.target.value)}>
                {RETURN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Kontakt">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="first_name" label="Vorname" error={errors.first_name}>
              <input type="text" {...a11y('first_name')} className={inputClass} maxLength={100} autoComplete="given-name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            </Field>
            <Field id="last_name" label="Nachname" error={errors.last_name}>
              <input type="text" {...a11y('last_name')} className={inputClass} maxLength={100} autoComplete="family-name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
            </Field>
            <Field id="company" label="Firma" optional error={errors.company}>
              <input type="text" {...a11y('company')} className={inputClass} maxLength={100} autoComplete="organization" value={form.company} onChange={(e) => set('company', e.target.value)} />
            </Field>
            <Field id="email" label="E-Mail" error={errors.email} hint="Hierhin geht die Buchungsbestätigung">
              <input type="email" {...a11y('email', true)} className={inputClass} maxLength={254} autoComplete="email" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field id="phone" label="Telefon" optional error={errors.phone}>
              <input type="tel" {...a11y('phone')} className={inputClass} maxLength={30} autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </div>
          <Field id="notes" label="Anmerkungen" optional error={errors.notes} hint={`${form.notes.length} / 1000 Zeichen`}>
            <textarea
              {...a11y('notes', true)}
              rows={3}
              maxLength={1000}
              className="block w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-base aria-[invalid=true]:border-danger focus:border-ink"
              placeholder="z. B. Flugnummer, besondere Wünsche"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </Section>

        {/* Honeypot: für Menschen unsichtbar, Bots füllen es aus */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
          <label htmlFor="website">Website (bitte leer lassen)</label>
          <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
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
              gelesen. Meine Angaben werden zur Abwicklung meiner Buchung verwendet.
            </span>
          </label>
          {errors.consent_privacy && (
            <p id="consent_privacy-error" className="mt-1 text-sm font-medium text-danger">
              {errors.consent_privacy}
            </p>
          )}

          <h2 className="mt-6 text-lg font-semibold">Zahlung mit PayPal</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Mit der Zahlung ist Ihre Buchung verbindlich und bestätigt.
          </p>
          <div className="mt-4 min-h-12" data-testid="paypal-area">
            {!clientId && <p className="text-sm text-danger">Die Online-Zahlung ist derzeit nicht verfügbar.</p>}
            {clientId && paypalState === 'loading' && <p className="text-sm text-ink-soft">Zahlung wird geladen …</p>}
            {clientId && paypalState === 'unavailable' && (
              <p className="text-sm text-danger">Die Zahlung konnte nicht geladen werden. Bitte laden Sie die Seite neu.</p>
            )}
            <div ref={paypalRef} className="max-w-sm" />
          </div>
        </div>
      </form>
    </div>
  )
}
