import { useEffect, useState, type ReactNode } from 'react'
import {
  DEFAULT_RETURN_BUFFER_MINUTES,
  emptyManualForm,
  manualAdapter,
  splitName,
  suggestPickupFromLanding,
  type ManualBookingForm,
} from '../../booking-adapters'
import { parseMoney } from '../../booking-adapters/parse'
import { listActiveServices, upsertBooking } from '../../lib/bookings'
import { formatMoney } from '../../lib/format'
import { loadParkosOptions } from '../../lib/imports'
import {
  CHARGING_FEE,
  CHARGING_KWH_PRICE,
  CHARGING_TARGETS,
  chargingDescription,
  chargingTargetFrom,
  listTariffs,
  tariffOptionLabel,
  websitePrice,
  type Tariff,
} from '../../lib/tariffs'
import { useDraft } from '../../lib/update/drafts'
import {
  FUEL_TYPE_LABEL,
  LANGUAGE_LABEL,
  PARKING_TYPE_LABEL,
  PAYMENT_STATUS_LABEL,
  RETURN_MODE_LABEL,
  type FuelType,
  type ParkingType,
  type PaymentStatus,
  type ReturnMode,
  type Service,
} from '../../types/domain'
import { Button, Dialog, ErrorList, Field, Select, TextInput } from '../ui'

/** Leistung „Laden“: im Formular unter Fahrzeug („E-Auto laden“) statt in der Leistungsliste */
const CHARGING_CODE = 'LADEN'

const money = (n: number) => formatMoney(n)
const moneyInput = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-5 first:mt-0">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </fieldset>
  )
}

/**
 * Buchung anlegen oder bearbeiten (`initial` gesetzt). Felder und Bezeichnungen wie im
 * Buchungsformular der Website. Entwürfe werden in IndexedDB gesichert und überstehen ein
 * Neuladen oder App-Update.
 */
export function BookingFormDialog({
  initial,
  draftKey,
  title,
  onClose,
  onSaved,
}: {
  initial?: ManualBookingForm
  /** eigener Entwurf, z. B. je Anfrage, damit die Vorbelegung nicht von „Neue Buchung“ überdeckt wird */
  draftKey?: string
  title?: string
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const editing = !!initial?.id
  const draft = useDraft<ManualBookingForm>(
    draftKey ?? (editing ? `booking-edit-${initial!.id}` : 'booking-new'),
    initial ?? emptyManualForm(),
  )
  const form = draft.value
  const [catalog, setCatalog] = useState<Service[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [bufferMinutes, setBufferMinutes] = useState(DEFAULT_RETURN_BUFFER_MINUTES)

  useEffect(() => {
    loadParkosOptions()
      .then((o) => setBufferMinutes(o.bufferMinutes))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    listActiveServices()
      .then(setCatalog)
      .catch((e: Error) => setErrors([e.message]))
    // Ohne Tarife (z. B. Spalten fehlen) bleibt die Auswahl der Stellplatzart
    listTariffs()
      .then(setTariffs)
      .catch(() => setTariffs([]))
  }, [])

  // Entwürfe älterer Versionen: Feld „Kunde“ in Vor- und Nachname aufteilen
  useEffect(() => {
    if (!draft.ready) return
    if (form.customer_name && !form.first_name && !form.last_name)
      draft.setValue((prev) => ({ ...prev, ...splitName(prev.customer_name), customer_name: '' }))
  }, [draft.ready])

  const set = <K extends keyof ManualBookingForm>(key: K, value: ManualBookingForm[K]) =>
    draft.setValue((prev) => ({ ...prev, [key]: value }))

  const tariff = tariffs.find((t) => t.code === form.tariff_code) ?? null

  function selectTariff(code: string) {
    const t = tariffs.find((x) => x.code === code)
    draft.setValue((prev) => ({ ...prev, tariff_code: code, ...(t ? { parking_type: t.parking_type } : {}) }))
  }

  function toggleService(code: string) {
    draft.setValue((prev) => {
      const services = { ...prev.services }
      if (services[code]) delete services[code]
      else services[code] = { price: '', description: '' }
      return { ...prev, services }
    })
  }

  function setServiceField(code: string, field: 'price' | 'description', value: string) {
    draft.setValue((prev) => ({
      ...prev,
      services: { ...prev.services, [code]: { ...prev.services[code], [field]: value } },
    }))
  }

  const charging = form.services[CHARGING_CODE]
  const chargingTarget = chargingTargetFrom(charging?.description)

  function toggleCharging(on: boolean) {
    draft.setValue((prev) => {
      const services = { ...prev.services }
      if (on) services[CHARGING_CODE] = { price: moneyInput(CHARGING_FEE), description: chargingDescription(CHARGING_TARGETS[0]) }
      else delete services[CHARGING_CODE]
      // wie auf der Website: Laden setzt den Antrieb auf Elektro, wenn noch keiner gewählt ist
      return { ...prev, services, fuel_type: on && !prev.fuel_type ? 'electric' : prev.fuel_type }
    })
  }

  function setChargingTarget(target: string) {
    draft.setValue((prev) => {
      const entry = prev.services[CHARGING_CODE]
      if (!entry) return prev
      const description = /Ladeziel:\s*\d{1,3}\s*%/.test(entry.description)
        ? entry.description.replace(/Ladeziel:\s*\d{1,3}\s*%/, `Ladeziel: ${target}`)
        : chargingDescription(target)
      return { ...prev, services: { ...prev.services, [CHARGING_CODE]: { ...entry, description } } }
    })
  }

  const pickupSuggestion = suggestPickupFromLanding(form.return_flight_date ?? '', form.return_flight_time ?? '', bufferMinutes)
  const pickupDiffers =
    !!pickupSuggestion && (pickupSuggestion.date !== form.end_date || pickupSuggestion.time !== form.end_time)

  function applyPickupSuggestion() {
    if (!pickupSuggestion) return
    draft.setValue((prev) => ({ ...prev, end_date: pickupSuggestion.date, end_time: pickupSuggestion.time }))
  }

  const price = tariff
    ? websitePrice(tariff, { startDate: form.start_date, endDate: form.end_date, returnMode: form.return_mode, charging: !!charging })
    : null
  const priceDiffers = !!price && parseMoney(form.price_total) !== price.total

  async function save() {
    // Neue Buchung mit Tarif: enthaltene Leistungen mitsenden. Der Trigger bucht sie ohnehin;
    // upsert_booking würde nicht gesendete Zusatzleistungen sonst gleich wieder stornieren.
    const toSave: ManualBookingForm = { ...form, services: { ...form.services } }
    if (!editing && tariff)
      for (const x of tariff.included_services) {
        const code = x.code.toUpperCase()
        if (!toSave.services[code]) toSave.services[code] = { price: '', description: x.description ?? '' }
      }
    const result = manualAdapter.normalize(toSave)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    setErrors([])
    try {
      const res = await upsertBooking(result.booking, manualAdapter.source)
      await draft.discard()
      onSaved(res.id)
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setSaving(false)
    }
  }

  async function discard() {
    await draft.discard()
    onClose()
  }

  const nameForTitle = [form.first_name, form.last_name].filter(Boolean).join(' ')
  // Leistungen außer „Laden“ (steht unter Fahrzeug); Standardleistung entfällt, wenn der Tarif sie ausschließt
  const services = catalog.filter((s) => s.code !== CHARGING_CODE)
  const included = new Map((tariff?.included_services ?? []).map((x) => [x.code.toUpperCase(), x.description ?? '']))

  return (
    <Dialog
      title={title ?? (editing ? `Buchung bearbeiten · ${initial!.plate}` : nameForTitle ? `Neue Buchung · ${nameForTitle}` : 'Neue Buchung')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => void discard()}>{editing ? 'Abbrechen' : 'Verwerfen'}</Button>
          <Button variant="primary" disabled={saving || !draft.ready} onClick={() => void save()}>
            {saving ? 'Speichert …' : editing ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      {draft.restored && (
        <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-dark">Entwurf wiederhergestellt.</p>
      )}
      {errors.length > 0 && (
        <div className="mb-3">
          <ErrorList errors={errors} />
        </div>
      )}

      <Section title="Tarif und Zeitraum">
        <Field label="Tarif">
          <Select value={form.tariff_code ?? ''} onChange={(e) => selectTariff(e.target.value)}>
            <option value="">Ohne Tarif (z. B. Parkos)</option>
            {tariffs.map((t) => (
              <option key={t.code} value={t.code}>{tariffOptionLabel(t)}</option>
            ))}
            {form.tariff_code && !tariff && tariffs.length > 0 && <option value={form.tariff_code}>{form.tariff_code}</option>}
          </Select>
        </Field>
        {tariff ? (
          <div className="flex items-end pb-2 text-sm text-muted">
            {money(tariff.base_price)} bis 5 Tage · +{money(tariff.extra_day_price)}/Tag
          </div>
        ) : (
          <Field label="Stellplatz">
            <Select value={form.parking_type} onChange={(e) => set('parking_type', e.target.value as ParkingType)}>
              {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Anreise *">
            <TextInput type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="Uhrzeit">
            <TextInput type="time" step={300} value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Rückkehr (Abholung) *">
            <TextInput type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
          <Field label="Uhrzeit">
            <TextInput type="time" step={300} value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
          </Field>
        </div>
        {tariff && (tariff.included_text || tariff.shuttle_text) && (
          <p className="rounded-lg bg-chip px-3 py-2 text-sm text-muted md:col-span-2" data-testid="tariff-included">
            <span className="font-medium text-ink">Im Tarif {tariff.label}:</span> {tariff.included_text}
            {tariff.shuttle_text && ` · Shuttle ${tariff.shuttle_text}`}
          </p>
        )}
      </Section>

      <Section title="Fahrzeug">
        <Field label="Kennzeichen *">
          <TextInput value={form.plate} autoCapitalize="characters" placeholder="z. B. M-AB 1234"
            onChange={(e) => set('plate', e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_9rem] gap-2">
          <Field label="Fahrzeugmodell">
            <TextInput value={form.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} />
          </Field>
          <Field label="Antrieb">
            <Select value={form.fuel_type} onChange={(e) => set('fuel_type', e.target.value as FuelType | '')}>
              <option value="">–</option>
              {Object.entries(FUEL_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className={`rounded-xl border px-3 py-2 md:col-span-2 ${charging ? 'border-accent bg-accent-soft/40' : 'border-line'}`}>
          <label className="touch-target flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={!!charging} onChange={(e) => toggleCharging(e.target.checked)}
              className="size-5 accent-accent" />
            <span>
              <span className="font-medium">E-Auto laden</span>
              <span className="text-muted"> · {money(CHARGING_FEE)} Ladepauschale + {money(CHARGING_KWH_PRICE)}/kWh bei Rückgabe</span>
            </span>
          </label>
          {charging && (
            <div className="mt-1 grid gap-2 pb-1 sm:grid-cols-[10rem_8rem_1fr]">
              <Select aria-label="Gewünschter Ladestand" value={chargingTarget} onChange={(e) => setChargingTarget(e.target.value)}>
                {CHARGING_TARGETS.map((t) => (
                  <option key={t} value={t}>{t === '80 %' ? '80 % (empfohlen)' : t}</option>
                ))}
                {!(CHARGING_TARGETS as readonly string[]).includes(chargingTarget) && <option value={chargingTarget}>{chargingTarget}</option>}
              </Select>
              <TextInput inputMode="decimal" placeholder="Preis €" aria-label="Preis Laden"
                value={charging.price} onChange={(e) => setServiceField(CHARGING_CODE, 'price', e.target.value)} />
              <TextInput placeholder="Vereinbarung / Beschreibung" aria-label="Beschreibung Laden"
                value={charging.description} onChange={(e) => setServiceField(CHARGING_CODE, 'description', e.target.value)} />
            </div>
          )}
        </div>
      </Section>

      <Section title="Transfer">
        <Field label="Rückgabe des Fahrzeugs">
          <Select value={form.return_mode} onChange={(e) => set('return_mode', e.target.value as ReturnMode)}>
            {Object.entries(RETURN_MODE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Flugnummer hin">
            <TextInput value={form.flight_out ?? ''} autoCapitalize="characters" placeholder="LH 2020"
              onChange={(e) => set('flight_out', e.target.value)} />
          </Field>
          <Field label="Flugnummer zurück">
            <TextInput value={form.flight_return ?? ''} autoCapitalize="characters" placeholder="LH 2021"
              onChange={(e) => set('flight_return', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Personen">
            <TextInput type="number" min={0} max={9} inputMode="numeric" value={form.persons}
              onChange={(e) => set('persons', e.target.value)} />
          </Field>
          <Field label="Kindersitze">
            <TextInput type="number" min={0} max={5} inputMode="numeric" placeholder="0" value={form.child_seats ?? ''}
              onChange={(e) => set('child_seats', e.target.value)} />
          </Field>
          <Field label="Gepäckstücke">
            <TextInput type="number" min={0} max={20} inputMode="numeric" placeholder="–" value={form.luggage ?? ''}
              onChange={(e) => set('luggage', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Landung Rückflug">
            <TextInput type="date" value={form.return_flight_date ?? ''}
              onChange={(e) => set('return_flight_date', e.target.value)} />
          </Field>
          <Field label="Uhrzeit">
            <TextInput type="time" value={form.return_flight_time ?? ''}
              onChange={(e) => set('return_flight_time', e.target.value)} />
          </Field>
        </div>
        <Field label="Transfer-Hinweis" className="md:col-span-2">
          <TextInput value={form.transfer_note ?? ''} placeholder="z. B. Inklusive Transfer (16 Minuten)"
            onChange={(e) => set('transfer_note', e.target.value)} />
        </Field>
        {pickupDiffers && pickupSuggestion && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-dark md:col-span-2">
            <span>
              Abholung laut Landung + {bufferMinutes} min:{' '}
              {pickupSuggestion.date.split('-').reverse().join('.')} {pickupSuggestion.time}
            </span>
            <Button onClick={applyPickupSuggestion}>Übernehmen</Button>
          </div>
        )}
      </Section>

      <Section title="Kontakt">
        <Field label="Vorname *">
          <TextInput value={form.first_name ?? ''} autoComplete="off" onChange={(e) => set('first_name', e.target.value)} />
        </Field>
        <Field label="Nachname">
          <TextInput value={form.last_name ?? ''} autoComplete="off" onChange={(e) => set('last_name', e.target.value)} />
        </Field>
        <Field label="E-Mail">
          <TextInput type="email" value={form.customer_email} onChange={(e) => set('customer_email', e.target.value)} />
        </Field>
        <Field label="Telefon">
          <TextInput type="tel" value={form.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} />
        </Field>
        <Field label="Firma">
          <TextInput value={form.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="Sprache">
          <Select value={form.customer_language ?? ''} onChange={(e) => set('customer_language', e.target.value)}>
            <option value="">–</option>
            {Object.entries(LANGUAGE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
            {form.customer_language && !LANGUAGE_LABEL[form.customer_language] && (
              <option value={form.customer_language}>{form.customer_language}</option>
            )}
          </Select>
        </Field>
        <Field label="Anmerkungen" className="md:col-span-2">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base md:text-sm" />
        </Field>
      </Section>

      <Section title="Preis und Zahlung">
        <Field label="Buchungs-Nr.">
          <TextInput value={form.external_ref} onChange={(e) => set('external_ref', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Gesamtpreis (€)">
            <TextInput inputMode="decimal" placeholder="z. B. 129,00" value={form.price_total}
              onChange={(e) => set('price_total', e.target.value)} />
          </Field>
          <Field label="Zahlung">
            <Select value={form.payment_status} onChange={(e) => set('payment_status', e.target.value as PaymentStatus)}>
              {Object.entries(PAYMENT_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>
        {price && tariff && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-chip px-3 py-2 text-sm md:col-span-2" data-testid="website-price">
            <span className="min-w-0 flex-1">
              Preis laut Website: <strong>{money(price.total)}</strong>
              <span className="text-muted">
                {' '}· {tariff.label}, {price.days} {price.days === 1 ? 'Tag' : 'Tage'}: Grundpreis {money(tariff.base_price)}
                {price.extraDays > 0 && ` + ${price.extraDays} × ${money(tariff.extra_day_price)}`}
                {price.valet > 0 && ` + Hol-/Bring-Service ${money(price.valet)}`}
                {price.discount > 0 && ` − Nachlass Selbst bringen/abholen ${money(price.discount)}`}
                {price.charging > 0 && ` + Ladepauschale ${money(price.charging)}`}
                {price.days < 5 && ' (Mindestdauer 5 Tage)'}
              </span>
            </span>
            {priceDiffers && <Button onClick={() => set('price_total', moneyInput(price.total))}>Übernehmen</Button>}
          </div>
        )}
      </Section>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-semibold">Leistungen</legend>
        {tariff && included.size > 0 && (
          <p className="mb-2 text-sm text-muted">Im Tarif {tariff.label} enthalten und beim Anlegen automatisch gebucht.</p>
        )}
        <div className="flex flex-col gap-2">
          {services.map((s) => {
            const entry = form.services[s.code]
            const excluded = s.is_default && !!tariff?.excluded_services.includes(s.code)
            const inTariff = !editing && included.has(s.code)
            const fixed = (s.is_default && !excluded) || inTariff
            const checked = fixed || !!entry
            return (
              <div key={s.id} className={`rounded-xl border px-3 py-2 ${checked ? 'border-accent bg-accent-soft/40' : 'border-line'}`}>
                <label className={`touch-target flex items-center gap-3 text-sm ${fixed || excluded ? '' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={checked} disabled={fixed || excluded}
                    onChange={() => toggleService(s.code)} className="size-5 accent-accent" />
                  <span className="font-medium">{s.name}</span>
                  {s.is_default && !excluded && <span className="text-xs text-muted">immer enthalten</span>}
                  {excluded && <span className="text-xs text-muted">nicht im Tarif {tariff!.label}</span>}
                  {inTariff && <span className="text-xs text-muted">im Tarif {tariff!.label}{included.get(s.code) ? `: ${included.get(s.code)}` : ''}</span>}
                </label>
                {entry && !inTariff && (
                  <div className="mt-1 grid gap-2 pb-1 sm:grid-cols-[8rem_1fr]">
                    <TextInput inputMode="decimal" placeholder="Preis €" aria-label={`Preis ${s.name}`}
                      value={entry.price} onChange={(e) => setServiceField(s.code, 'price', e.target.value)} />
                    <TextInput placeholder="Vereinbarung / Beschreibung" aria-label={`Beschreibung ${s.name}`}
                      value={entry.description} onChange={(e) => setServiceField(s.code, 'description', e.target.value)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </fieldset>
    </Dialog>
  )
}
