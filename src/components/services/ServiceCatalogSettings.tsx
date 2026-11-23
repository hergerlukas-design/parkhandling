import { useEffect, useState } from 'react'
import { formatMoney } from '../../lib/format'
import {
  emptyServiceForm,
  listAllServices,
  saveService,
  SERVICE_CATEGORY_LABEL,
  serviceToForm,
  tariffUsage,
  validateServiceForm,
  type ServiceForm,
} from '../../lib/services'
import type { Service } from '../../types/domain'
import { Button, ErrorList, Field, Select, TextInput } from '../ui'

type Usage = Awaited<ReturnType<typeof tariffUsage>>

/**
 * Leistungskatalog: Name, Kategorie, Preis, Beschreibung und Checkliste je Leistung.
 * Admins bearbeiten, übriges Personal sieht den Katalog nur.
 */
export function ServiceCatalogSettings({ admin }: { admin: boolean }) {
  const [services, setServices] = useState<Service[] | null>(null)
  const [usage, setUsage] = useState<Usage>({ included: {}, excluded: {} })
  const [error, setError] = useState<string | null>(null)
  /** id der geöffneten Leistung, „new“ für eine neue */
  const [open, setOpen] = useState<string | null>(null)

  function load() {
    listAllServices()
      .then(setServices)
      .catch((e: Error) => setError(e.message))
    tariffUsage()
      .then(setUsage)
      .catch(() => undefined)
  }
  useEffect(load, [])

  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!services) return <p className="text-sm text-muted">Lädt …</p>

  const nextSort = Math.max(0, ...services.map((s) => s.sort_order)) + 10

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-subtle">
        Änderungen gelten für Leistungen, die ab jetzt gebucht werden. Bereits angelegte Aufgaben behalten ihre Checkliste.
      </p>
      {services.map((s) =>
        open === s.id ? (
          <ServiceEditor
            key={s.id}
            initial={serviceToForm(s)}
            admin={admin}
            existingCodes={services.map((x) => x.code)}
            onCancel={() => setOpen(null)}
            onSaved={() => {
              setOpen(null)
              load()
            }}
          />
        ) : (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpen(s.id)}
            className={`touch-target flex w-full flex-col gap-0.5 rounded-xl border border-line px-3 py-2 text-left hover:bg-ground ${s.active ? '' : 'opacity-60'}`}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-muted">{s.code}</span>
              {s.is_default && <Badge>Standard</Badge>}
              {!s.active && <Badge>inaktiv</Badge>}
              <span className="ml-auto text-sm text-muted">{s.price != null ? formatMoney(Number(s.price)) : 'ohne Preis'}</span>
            </span>
            <span className="text-xs text-muted">
              {SERVICE_CATEGORY_LABEL[s.category] ?? s.category} · {s.steps?.length ?? 0} Schritte
              {usage.included[s.code] && ` · im Tarif ${usage.included[s.code].join(', ')}`}
              {usage.excluded[s.code] && ` · nicht im Tarif ${usage.excluded[s.code].join(', ')}`}
            </span>
          </button>
        ),
      )}
      {admin &&
        (open === 'new' ? (
          <ServiceEditor
            initial={emptyServiceForm(nextSort)}
            admin
            existingCodes={services.map((x) => x.code)}
            onCancel={() => setOpen(null)}
            onSaved={() => {
              setOpen(null)
              load()
            }}
          />
        ) : (
          <div>
            <Button onClick={() => setOpen('new')}>+ Neue Leistung</Button>
          </div>
        ))}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-chip px-2 py-0.5 text-xs font-medium text-muted">{children}</span>
}

function ServiceEditor({
  initial,
  admin,
  existingCodes,
  onCancel,
  onSaved,
}: {
  initial: ServiceForm
  admin: boolean
  existingCodes: string[]
  onCancel: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const isNew = !initial.id
  const readOnly = !admin

  const set = <K extends keyof ServiceForm>(key: K, value: ServiceForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setStep = (i: number, value: string) => setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? value : s)) }))
  const removeStep = (i: number) => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))
  const moveStep = (i: number, d: -1 | 1) =>
    setForm((f) => {
      const steps = [...f.steps]
      const j = i + d
      if (j < 0 || j >= steps.length) return f
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...f, steps }
    })

  async function save() {
    const result = validateServiceForm(form, existingCodes)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    setErrors([])
    try {
      await saveService(form.id, result.row)
      onSaved()
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-accent bg-accent-soft/30 p-3" data-testid="service-editor">
      {errors.length > 0 && (
        <div className="mb-3">
          <ErrorList errors={errors} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *">
          <TextInput value={form.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={isNew ? 'Code * (Großbuchstaben, z. B. REINIGUNG_AUSSEN)' : 'Code (fest)'}>
          <TextInput value={form.code} disabled={!isNew || readOnly} autoCapitalize="characters"
            onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Kategorie">
          <Select value={form.category} disabled={readOnly} onChange={(e) => set('category', e.target.value)}>
            {Object.entries(SERVICE_CATEGORY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Preis (€)">
            <TextInput inputMode="decimal" placeholder="ohne Preis" value={form.price} disabled={readOnly}
              onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field label="Reihenfolge">
            <TextInput type="number" min={0} max={9999} inputMode="numeric" value={form.sort_order} disabled={readOnly}
              onChange={(e) => set('sort_order', e.target.value)} />
          </Field>
        </div>
        <Field label="Beschreibung" className="sm:col-span-2">
          <TextInput value={form.description} disabled={readOnly} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>

      <fieldset className="mt-3">
        <legend className="mb-1 text-sm font-medium text-subtle">Checkliste (Teilschritte der Aufgabe)</legend>
        <ol className="flex flex-col gap-2">
          {form.steps.map((step, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-sm text-muted">{i + 1}.</span>
              <TextInput value={step} disabled={readOnly} aria-label={`Schritt ${i + 1}`}
                onChange={(e) => setStep(i, e.target.value)} />
              {!readOnly && (
                <>
                  <button type="button" aria-label={`Schritt ${i + 1} nach oben`} disabled={i === 0} onClick={() => moveStep(i, -1)}
                    className="touch-target shrink-0 rounded-lg px-2 text-muted hover:bg-chip disabled:opacity-30">↑</button>
                  <button type="button" aria-label={`Schritt ${i + 1} nach unten`} disabled={i === form.steps.length - 1} onClick={() => moveStep(i, 1)}
                    className="touch-target shrink-0 rounded-lg px-2 text-muted hover:bg-chip disabled:opacity-30">↓</button>
                  <button type="button" aria-label={`Schritt ${i + 1} entfernen`} onClick={() => removeStep(i)}
                    className="touch-target shrink-0 rounded-lg px-2 text-danger hover:bg-chip">×</button>
                </>
              )}
            </li>
          ))}
        </ol>
        {form.steps.length === 0 && <p className="text-sm text-muted">Keine Schritte: Die Aufgabe wird nur als Ganzes erledigt.</p>}
        {!readOnly && (
          <Button className="mt-2" onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, ''] }))}>+ Schritt</Button>
        )}
      </fieldset>

      <div className="mt-3 flex flex-col gap-1">
        <label className="touch-target flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-accent" checked={form.active} disabled={readOnly}
            onChange={(e) => set('active', e.target.checked)} />
          Aktiv (inaktive Leistungen sind nicht mehr buchbar)
        </label>
        <label className="touch-target flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-accent" checked={form.is_default} disabled={readOnly}
            onChange={(e) => set('is_default', e.target.checked)} />
          Standard (wird bei jeder neuen Buchung automatisch gebucht, außer der Tarif schließt sie aus)
        </label>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>{readOnly ? 'Schließen' : 'Abbrechen'}</Button>
        {!readOnly && (
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Speichert …' : isNew ? 'Anlegen' : 'Speichern'}
          </Button>
        )}
      </div>
    </div>
  )
}
