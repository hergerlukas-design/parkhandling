import { useEffect, useMemo, useState } from 'react'
import { hallLayout, loadBoard, previewHallLayout, setHallLayout, type BoardSlot } from '../../lib/siteplan'
import { Button, Dialog, ErrorList } from '../ui'

const MAX_RACKS = 30
const MAX_LEVELS = 5

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

/** Admin: Halle auf Regale × Ebenen umstellen. Wegfallende Plätze werden deaktiviert, nicht gelöscht. */
export function HallLayoutSettings() {
  const [board, setBoard] = useState<BoardSlot[]>([])
  const [racks, setRacks] = useState(0)
  const [levels, setLevels] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function reload() {
    try {
      const next = await loadBoard()
      const current = hallLayout(next)
      setBoard(next)
      setRacks(current.racks)
      setLevels(current.levels)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const current = useMemo(() => hallLayout(board), [board])
  const preview = useMemo(() => previewHallLayout(board, racks, levels), [board, racks, levels])
  const changed = racks !== current.racks || levels !== current.levels

  async function apply() {
    setSaving(true)
    try {
      const r = await setHallLayout(racks, levels)
      setConfirming(false)
      setDone(`Halle umgestellt: ${racks} Regale × ${levels} Ebenen (${r.created + r.activated} Plätze dazu, ${r.deactivated} deaktiviert).`)
      await reload()
    } catch (e) {
      setConfirming(false)
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-subtle">
        Aktuell {current.racks} Regale × {current.levels} Ebenen = {current.racks * current.levels} Plätze.
      </p>
      <ErrorList errors={error ? [error] : []} />
      {done && <p className="rounded-lg bg-ok-soft px-4 py-2 text-sm text-ok-ink">{done}</p>}
      <div>
        <Stepper label="Regale" value={racks} min={1} max={MAX_RACKS} onChange={(v) => { setRacks(v); setDone(null) }} />
        <Stepper label="Ebenen" value={levels} min={1} max={MAX_LEVELS} onChange={(v) => { setLevels(v); setDone(null) }} />
      </div>
      {changed && (
        <div className="text-sm">
          <p>
            Neu: {racks} × {levels} = {racks * levels} Plätze
            {preview.added > 0 && ` · ${preview.added} kommen dazu`}
            {preview.removed.length > 0 && ` · ${preview.removed.length} fallen weg`}
          </p>
          {preview.blockers.length > 0 && (
            <p className="mt-2 rounded-lg bg-danger-soft px-4 py-2 text-danger-ink">
              Erst umsetzen bzw. freigeben: {preview.blockers.map((s) => `${s.code} (${s.plate ?? 'reserviert'})`).join(', ')}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!changed || preview.blockers.length > 0} onClick={() => setConfirming(true)}>
          Halle umstellen
        </Button>
        {changed && (
          <Button onClick={() => { setRacks(current.racks); setLevels(current.levels) }}>Zurücksetzen</Button>
        )}
      </div>
      {confirming && (
        <Dialog
          title="Halle umstellen?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Abbrechen</Button>
              <Button variant="primary" disabled={saving} onClick={() => void apply()}>
                {saving ? 'Wird umgestellt …' : 'Umstellen'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Die Halle wird auf <strong>{racks} Regale × {levels} Ebenen</strong> umgestellt.
          </p>
          {preview.removed.length > 0 && (
            <p className="mt-2 text-sm text-subtle">
              Deaktiviert werden: {preview.removed.map((s) => s.code).join(', ')}. Sie verschwinden aus Lageplan,
              Vorschlägen und Etiketten, bleiben aber gespeichert und kommen beim Vergrößern wieder.
            </p>
          )}
          {preview.added > 0 && (
            <p className="mt-2 text-sm text-subtle">
              {preview.added} Plätze kommen dazu. Etiketten unter „Stellplätze/QR-Codes“ drucken.
            </p>
          )}
        </Dialog>
      )}
    </div>
  )
}
