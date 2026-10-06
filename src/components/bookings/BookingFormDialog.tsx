import { useEffect, useState } from 'react'
import { emptyManualForm, manualAdapter, type ManualBookingForm } from '../../booking-adapters'
import { listActiveServices, upsertBooking } from '../../lib/bookings'
import { useDraft } from '../../lib/update/drafts'
import {
  FUEL_TYPE_LABEL,
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

/**
 * Buchung anlegen oder bearbeiten (`initial` gesetzt). Entwürfe werden in IndexedDB gesichert
 * und überstehen ein Neuladen oder App-Update.
 */
export function BookingFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: ManualBookingForm
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const editing = !!initial?.id
  const draft = useDraft<ManualBookingForm>(editing ? `booking-edit-${initial!.id}` : 'booking-new', initial ?? emptyManualForm())
  const form = draft.value
  const [catalog, setCatalog] = useState<Service[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listActiveServices()
      .then(setCatalog)
      .catch((e: Error) => setErrors([e.message]))
  }, [])

  const set = <K extends keyof ManualBookingForm>(key: K, value: ManualBookingForm[K]) =>
    draft.setValue((prev) => ({ ...prev, [key]: value }))

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

  async function save() {
    const result = manualAdapter.normalize(form)
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

  return (
    <Dialog
      title={editing ? `Buchung bearbeiten · ${initial!.plate}` : 'Neue Buchung'}
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

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Kunde *">
          <TextInput value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} />
        </Field>
        <Field label="Firma">
          <TextInput value={form.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="Telefon">
          <TextInput type="tel" value={form.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} />
        </Field>
        <Field label="E-Mail">
          <TextInput type="email" value={form.customer_email} onChange={(e) => set('customer_email', e.target.value)} />
        </Field>
        <Field label="Kennzeichen *">
          <TextInput value={form.plate} autoCapitalize="characters" placeholder="M-AB 1234"
            onChange={(e) => set('plate', e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_9rem] gap-2">
          <Field label="Fahrzeug">
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
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Anreise *">
            <TextInput type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="Uhrzeit">
            <TextInput type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Abholung *">
            <TextInput type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
          <Field label="Uhrzeit">
            <TextInput type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
          </Field>
        </div>
        <Field label="Parkplatz">
          <Select value={form.parking_type} onChange={(e) => set('parking_type', e.target.value as ParkingType)}>
            {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Rückgabe">
            <Select value={form.return_mode} onChange={(e) => set('return_mode', e.target.value as ReturnMode)}>
              {Object.entries(RETURN_MODE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Personen">
            <TextInput type="number" min={0} max={50} inputMode="numeric" value={form.persons}
              onChange={(e) => set('persons', e.target.value)} />
          </Field>
        </div>
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
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-semibold">Leistungen</legend>
        <div className="flex flex-col gap-2">
          {catalog.map((s) => {
            const entry = form.services[s.code]
            const checked = s.is_default || !!entry
            return (
              <div key={s.id} className={`rounded-xl border px-3 py-2 ${checked ? 'border-accent bg-accent-soft/40' : 'border-line'}`}>
                <label className={`touch-target flex items-center gap-3 text-sm ${s.is_default ? '' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={checked} disabled={s.is_default}
                    onChange={() => toggleService(s.code)} className="size-5 accent-accent" />
                  <span className="font-medium">{s.name}</span>
                  {s.is_default && <span className="text-xs text-muted">immer enthalten</span>}
                </label>
                {entry && (
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

      <Field label="Besondere Wünsche / Notizen" className="mt-4">
        <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base md:text-sm" />
      </Field>
    </Dialog>
  )
}
