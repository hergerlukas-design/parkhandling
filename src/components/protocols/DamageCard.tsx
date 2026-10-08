import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DamageEntry } from '../../lib/protocols'
import { Button } from '../ui'
import { CarDamageSelector } from './CarDamageSelector'

interface Props {
  /** Gespeicherter Stand des Schadens (bzw. Vorgabe bei neuen Einträgen) */
  damage: DamageEntry
  index: number
  /** Neu seit der Annahme (Vergleich) */
  isNew: boolean
  /** Positionen der übrigen Schäden, rot markiert in der Grafik */
  markers: string[]
  readOnly: boolean
  /** Fotos des Schadens (Slot schaden_<id>) */
  photo: ReactNode
  onSave: (entry: DamageEntry) => void
  onRemove: () => void
  onDirtyChange: (dirty: boolean) => void
}

/**
 * Schadenseintrag mit eigenem Speichern-Button. Änderungen gelten erst nach „Speichern“;
 * bereits hochgeladene Fotos hängen an der stabilen Schaden-ID und bleiben erhalten.
 */
export function DamageCard({ damage, index, isNew, markers, readOnly, photo, onSave, onRemove, onDirtyChange }: Props) {
  const [draft, setDraft] = useState({ pos: damage.pos, desc: damage.desc })
  // Sichtbare Bestätigung nach „Speichern“, klingt nach wenigen Sekunden wieder ab
  const [justSaved, setJustSaved] = useState(false)

  const dirty = draft.pos !== damage.pos || draft.desc !== damage.desc
  const complete = !!draft.pos && draft.desc.trim() !== ''

  // Aktuelle Callback-Referenz, damit der Effekt nicht bei jedem Render neu läuft
  const report = useRef(onDirtyChange)
  report.current = onDirtyChange
  useEffect(() => {
    report.current(dirty)
  }, [dirty])
  // Entfernte Karte zählt nicht mehr als ungespeichert
  useEffect(() => () => report.current(false), [])

  // Zustand von außen (z. B. nach dem Speichern oder beim Laden) übernehmen, sobald nichts offen ist
  useEffect(() => {
    setDraft((d) => (dirty ? d : { pos: damage.pos, desc: damage.desc }))
  }, [damage.pos, damage.desc])

  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), 3000)
    return () => clearTimeout(t)
  }, [justSaved])

  function save() {
    onSave({ id: damage.id, pos: draft.pos, desc: draft.desc })
    setJustSaved(true)
  }

  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${isNew ? 'border-danger/50' : 'border-line'} ${dirty ? 'ring-2 ring-warn/40' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-danger text-xs text-white">{index + 1}</span>
          Schaden {index + 1}
          {isNew && <span className="rounded-full bg-danger-soft px-2 text-xs text-danger-ink">neu seit Annahme</span>}
          {dirty && <span className="rounded-full bg-warn-soft px-2 text-xs text-warn-ink">nicht gespeichert</span>}
        </span>
        {!readOnly && (
          <button type="button" className="touch-target px-2 text-sm text-danger" onClick={onRemove}>
            Entfernen
          </button>
        )}
      </div>
      <CarDamageSelector
        value={draft.pos}
        onChange={(pos) => setDraft((d) => ({ ...d, pos }))}
        markers={markers}
        readOnly={readOnly}
      />
      <textarea
        aria-label="Beschreibung"
        rows={2}
        placeholder="Beschreibung, z. B. Kratzer ca. 10 cm, oberflächlich"
        value={draft.desc}
        disabled={readOnly}
        onChange={(e) => setDraft((d) => ({ ...d, desc: e.target.value }))}
        className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base md:text-sm"
      />
      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          {dirty && !complete && <span className="text-xs text-muted">Position und Beschreibung angeben</span>}
          {justSaved && !dirty && (
            <span role="status" className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok-ink">
              Schaden gespeichert
            </span>
          )}
          <Button variant="primary" disabled={!dirty || !complete} onClick={save}>
            {dirty ? 'Speichern' : 'Gespeichert'}
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3">{photo}</div>
    </div>
  )
}
