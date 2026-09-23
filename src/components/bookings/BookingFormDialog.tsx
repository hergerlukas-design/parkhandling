import { useEffect, useState } from 'react'
import { emptyManualForm, manualAdapter, type ManualBookingForm } from '../../booking-adapters'
import { listActiveServices, upsertBooking } from '../../lib/bookings'
import { useDraft } from '../../lib/update/drafts'
import { PARKING_TYPE_LABEL, type ParkingType, type ReturnMode, type Service } from '../../types/domain'
import { Button, Dialog, ErrorList, Field, Select, TextInput } from '../ui'

const RETURN_LABEL: Record<ReturnMode, string> = { shuttle: 'Shuttle', vallet: 'Vallet', self: 'Selbst' }

/** Buchung manuell anlegen. Entwurf wird in IndexedDB gesichert (übersteht Neuladen/Update). */
export function BookingFormDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const draft = useDraft<ManualBookingForm>('booking-new', emptyManualForm())
  const form = draft.value
  const [services, setServices] = useState<Service[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listActiveServices()
      .then(setServices)
      .catch((e: Error) => setErrors([e.message]))
  }, [])

  const set = <K extends keyof ManualBookingForm>(key: K, value: ManualBookingForm[K]) =>
    draft.setValue((prev) => ({ ...prev, [key]: value }))

  function toggleService(code: string) {
    draft.setValue((prev) => ({
      ...prev,
      services: prev.services.includes(code) ? prev.services.filter((c) => c !== code) : [...prev.services, code],
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
    draft.setValue(emptyManualForm())
    onClose()
  }

  return (
    <Dialog
      title="Neue Buchung"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => void discard()}>Verwerfen</Button>
          <Button variant="primary" disabled={saving || !draft.ready} onClick={() => void save()}>
            {saving ? 'Speichert …' : 'Anlegen'}
          </Button>
        </>
      }
    >
      {draft.restored && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">Entwurf wiederhergestellt.</p>
      )}
      {errors.length > 0 && (
        <div className="mb-3">
          <ErrorList errors={errors} />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Kundenname *">
          <TextInput value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} />
        </Field>
        <Field label="Kennzeichen *">
          <TextInput value={form.plate} autoCapitalize="characters" onChange={(e) => set('plate', e.target.value)} />
        </Field>
        <Field label="E-Mail">
          <TextInput type="email" value={form.customer_email} onChange={(e) => set('customer_email', e.target.value)} />
        </Field>
        <Field label="Telefon">
          <TextInput type="tel" value={form.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} />
        </Field>
        <Field label="Fahrzeug">
          <TextInput value={form.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} />
        </Field>
        <Field label="Buchungsnummer (optional)">
          <TextInput value={form.external_ref} onChange={(e) => set('external_ref', e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Ankunft *">
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
        <Field label="Parkart">
          <Select value={form.parking_type} onChange={(e) => set('parking_type', e.target.value as ParkingType)}>
            {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Rückgabe">
            <Select value={form.return_mode} onChange={(e) => set('return_mode', e.target.value as ReturnMode)}>
              {Object.entries(RETURN_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Personen">
            <TextInput type="number" min={0} max={50} inputMode="numeric" value={form.persons}
              onChange={(e) => set('persons', e.target.value)} />
          </Field>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-slate-700">Leistungen</legend>
        <div className="flex flex-wrap gap-2">
          {services.map((s) => {
            const checked = s.is_default || form.services.includes(s.code)
            return (
              <label key={s.id}
                className={`touch-target flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  checked ? 'border-brand-500 bg-brand-50' : 'border-slate-300'
                } ${s.is_default ? 'opacity-70' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={checked} disabled={s.is_default}
                  onChange={() => toggleService(s.code)} className="size-4" />
                {s.name}
                {s.price > 0 && (
                  <span className="text-slate-500">
                    {Number(s.price).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                  </span>
                )}
              </label>
            )
          })}
        </div>
      </fieldset>

      <Field label="Bemerkung" className="mt-4">
        <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base md:text-sm" />
      </Field>
    </Dialog>
  )
}
