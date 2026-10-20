import { useEffect, useState } from 'react'
import {
  hallLayout,
  loadBoard,
  outdoorLayout,
  previewHallLayout,
  previewOutdoorLayout,
  setHallLayout,
  setOutdoorLayout,
  type BoardSlot,
  type LayoutPreview,
  type LayoutResult,
  type OutdoorArea,
} from '../../lib/siteplan'
import { Button, Dialog, ErrorList } from '../ui'

function Stepper({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <Button aria-label={`${label} weniger`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</Button>
        <span className="w-8 text-center text-base font-semibold tabular-nums">{value}</span>
        <Button aria-label={`${label} mehr`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</Button>
      </span>
    </div>
  )
}

interface Dimension {
  label: string
  max: number
}

/**
 * Ein Bereich mit zwei Größen (Halle: Regale × Ebenen, Außen: Reihen × Plätze je Reihe).
 * Wegfallende Plätze werden deaktiviert, nicht gelöscht; belegte oder reservierte sperren die Umstellung.
 */
function LayoutEditor({ title, dims, current, preview, apply, onApplied }: {
  title: string
  dims: [Dimension, Dimension]
  current: [number, number]
  preview: (a: number, b: number) => LayoutPreview
  apply: (a: number, b: number) => Promise<LayoutResult>
  onApplied: () => Promise<void>
}) {
  const [values, setValues] = useState(current)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // nach dem Umstellen die neue Größe übernehmen
  useEffect(() => setValues([current[0], current[1]]), [current[0], current[1]])

  const [a, b] = values
  const p = preview(a, b)
  const changed = a !== current[0] || b !== current[1]

  function change(i: 0 | 1, v: number) {
    setValues(i === 0 ? [v, b] : [a, v])
    setDone(null)
    setError(null)
  }

  async function run() {
    setSaving(true)
    try {
      const r = await apply(a, b)
      setDone(`${title} umgestellt: ${r.created + r.activated} Plätze dazu, ${r.deactivated} deaktiviert.`)
      await onApplied()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConfirming(false)
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-2 border-b border-line pb-4 last:border-0 last:pb-0">
      <h3 className="flex items-baseline justify-between text-sm font-semibold">
        {title}
        <span className="font-normal text-muted">
          aktuell {current[0]} × {current[1]} = {current[0] * current[1]} Plätze
        </span>
      </h3>
      <ErrorList errors={error ? [error] : []} />
      {done && <p className="rounded-lg bg-ok-soft px-4 py-2 text-sm text-ok-ink">{done}</p>}
      <div>
        <Stepper label={dims[0].label} value={a} min={1} max={dims[0].max} onChange={(v) => change(0, v)} />
        <Stepper label={dims[1].label} value={b} min={1} max={dims[1].max} onChange={(v) => change(1, v)} />
      </div>
      {changed && (
        <div className="text-sm">
          <p>
            Neu: {a} × {b} = {a * b} Plätze
            {p.added > 0 && ` · ${p.added} kommen dazu`}
            {p.removed.length > 0 && ` · ${p.removed.length} fallen weg`}
          </p>
          {p.blockers.length > 0 && (
            <p className="mt-2 rounded-lg bg-danger-soft px-4 py-2 text-danger-ink">
              Erst umsetzen bzw. freigeben: {p.blockers.map((s) => `${s.code} (${s.plate ?? 'reserviert'})`).join(', ')}
            </p>
          )}
        </div>
      )}
      {changed && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={p.blockers.length > 0} onClick={() => setConfirming(true)}>
            {title} umstellen
          </Button>
          <Button onClick={() => setValues(current)}>Zurücksetzen</Button>
        </div>
      )}
      {confirming && (
        <Dialog
          title={`${title} umstellen?`}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Abbrechen</Button>
              <Button variant="primary" disabled={saving} onClick={() => void run()}>
                {saving ? 'Wird umgestellt …' : 'Umstellen'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {title} wird auf <strong>{a} {dims[0].label} × {b} {dims[1].label}</strong> umgestellt.
          </p>
          {p.removed.length > 0 && (
            <p className="mt-2 text-sm text-subtle">
              Deaktiviert werden: {p.removed.map((s) => s.code).join(', ')}. Sie verschwinden aus Lageplan,
              Vorschlägen und Etiketten, bleiben aber gespeichert und kommen beim Vergrößern wieder.
            </p>
          )}
          {p.added > 0 && (
            <p className="mt-2 text-sm text-subtle">
              {p.added} Plätze kommen dazu. Etiketten unter „Stellplätze/QR-Codes“ drucken.
            </p>
          )}
        </Dialog>
      )}
    </section>
  )
}

const OUTDOOR: { area: OutdoorArea; title: string }[] = [
  { area: 'outdoor_a', title: 'Außen A (mit Plane)' },
  { area: 'outdoor_b', title: 'Außen B (ohne Plane)' },
]

/** Admin: Halle und Außenflächen in der Größe umstellen. */
export function SiteLayoutSettings() {
  const [board, setBoard] = useState<BoardSlot[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    try {
      setBoard(await loadBoard())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  if (!board) return error ? <ErrorList errors={[error]} /> : <p className="text-sm text-muted">Lädt …</p>

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorList errors={[error]} />}
      <LayoutEditor
        title="Halle"
        dims={[{ label: 'Regale', max: 30 }, { label: 'Ebenen', max: 5 }]}
        current={[hallLayout(board).racks, hallLayout(board).levels]}
        preview={(a, b) => previewHallLayout(board, a, b)}
        apply={setHallLayout}
        onApplied={reload}
      />
      {OUTDOOR.map(({ area, title }) => {
        const size = outdoorLayout(board, area)
        return (
          <LayoutEditor
            key={area}
            title={title}
            dims={[{ label: 'Reihen', max: 9 }, { label: 'Plätze je Reihe', max: 99 }]}
            current={[size.rows, size.places]}
            preview={(a, b) => previewOutdoorLayout(board, area, a, b)}
            apply={(a, b) => setOutdoorLayout(area, a, b)}
            onApplied={reload}
          />
        )
      })}
    </div>
  )
}
