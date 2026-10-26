import { useCallback, useEffect, useState } from 'react'
import { formatTime } from '../../lib/format'
import {
  completeChargeTask,
  formatEnergyParts,
  formatKwh,
  getTaskEnergy,
  parseKwh,
  saveEnergyParts,
  sumEnergy,
  type BoardTask,
  type EnergyPart,
  type TaskEnergy,
} from '../../lib/tasks'
import { Button, ErrorList, Field, TextInput } from '../ui'

/**
 * Aufgabe „Laden“: geladene Energie erfassen.
 * Bricht eine Ladung ab und wird neu angesteckt, zählt die Säule wieder ab 0 kWh. Deshalb wird jeder
 * Ladevorgang einzeln erfasst (Zwischenstand vor dem Neu-Anstecken) und beim Erledigt summiert.
 */
export function ChargeEnergy({
  task,
  finishing,
  onCancelFinish,
  onChanged,
  onDone,
}: {
  task: BoardTask
  finishing: boolean
  onCancelFinish: () => void
  onChanged: () => void
  onDone: () => void
}) {
  const [energy, setEnergy] = useState<TaskEnergy>({ total: null, parts: [] })
  const [interim, setInterim] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([''])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setEnergy(await getTaskEnergy(task.id))
  }, [task.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (finishing) {
      setLines([''])
      setError(null)
      setInterim(null)
    }
  }, [finishing])

  const parts = energy.parts
  const done = task.status === 'done'
  const editable = task.status === 'in_progress'

  async function run(action: () => Promise<void>, after?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
      onChanged()
      after?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function saveInterim() {
    const kwh = parseKwh(interim ?? '')
    if (kwh === null) return setError('Stand in kWh angeben, z. B. 3,1')
    void run(() => saveEnergyParts(task.id, [...parts, { kwh, at: new Date().toISOString() }]), () => setInterim(null))
  }

  function removePart(index: number) {
    void run(() => saveEnergyParts(task.id, parts.filter((_, i) => i !== index)))
  }

  // Beim Erledigt: Stand der letzten Ladung + ggf. vergessene Ladevorgänge
  const parsed = lines.map((l) => (l.trim() ? parseKwh(l) : undefined))
  const invalid = parsed.some((v) => v === null)
  const newParts: EnergyPart[] = parsed
    .filter((v): v is number => typeof v === 'number')
    .map((kwh) => ({ kwh, at: new Date().toISOString() }))
  const finalParts = [...parts, ...newParts]

  function finish() {
    if (invalid) return setError('Bitte jeden Wert in kWh angeben, z. B. 22,5 (0 bis 500)')
    if (finalParts.length === 0) return setError('Wie viel wurde geladen? Stand vom Display der Säule eintragen.')
    void run(() => completeChargeTask(task.id, finalParts), onDone)
  }

  return (
    <section className="flex flex-col gap-3">
      {parts.length > 0 && (
        <div className="rounded-xl border border-line p-3 text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">Ladevorgänge</h3>
            <span className="font-semibold">{formatKwh(sumEnergy(parts))}</span>
          </div>
          <ul className="flex flex-col gap-1">
            {parts.map((p, i) => (
              <li key={`${p.at}-${i}`} className="flex items-center justify-between gap-2">
                <span>{i + 1}. {formatKwh(p.kwh)} <span className="text-subtle">· {formatTime(p.at)}</span></span>
                {editable && !finishing && (
                  <button type="button" disabled={busy} onClick={() => removePart(i)} aria-label={`Ladevorgang ${i + 1} entfernen`}
                    className="touch-target flex items-center justify-center rounded-lg px-2 text-lg leading-none text-muted hover:bg-chip">
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && energy.total !== null && (
        <p className="rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok-ink">
          Geladen: <strong>{formatKwh(energy.total)}</strong>
          {parts.length > 1 && <> ({parts.length} Ladevorgänge: {formatEnergyParts(parts)})</>}
        </p>
      )}

      {editable && !finishing && interim === null && (
        <div className="rounded-xl bg-ground p-3 text-sm">
          <p className="text-subtle">
            Ladung abgebrochen? Die Säule zählt nach dem Neu-Anstecken wieder ab 0. Vorher den Stand vom Display erfassen.
          </p>
          <Button className="mt-2" disabled={busy} onClick={() => { setError(null); setInterim('') }}>
            Zwischenstand erfassen
          </Button>
        </div>
      )}

      {editable && !finishing && interim !== null && (
        <div className="flex flex-col gap-2 rounded-xl border border-accent bg-accent-soft p-3">
          <Field label="Stand des abgebrochenen Ladevorgangs (kWh)">
            <TextInput autoFocus inputMode="decimal" value={interim} placeholder="z. B. 3,1"
              onChange={(e) => setInterim(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveInterim()} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => setInterim(null)}>Abbrechen</Button>
            <Button variant="primary" disabled={busy} onClick={saveInterim}>Speichern</Button>
          </div>
        </div>
      )}

      {finishing && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent bg-accent-soft p-3">
          {lines.map((value, i) => (
            <Field key={i} label={i === 0
              ? `Wie viel wurde geladen? ${parts.length ? 'Letzter Ladevorgang' : 'Stand vom Display'} (kWh)`
              : `Weiterer Ladevorgang (kWh)`}>
              <span className="flex gap-2">
                <TextInput autoFocus={i === lines.length - 1} inputMode="decimal" value={value}
                  placeholder={i === 0 && parts.length ? 'leer = kein weiterer' : 'z. B. 22,5'}
                  onChange={(e) => setLines(lines.map((l, j) => (j === i ? e.target.value : l)))}
                  onKeyDown={(e) => e.key === 'Enter' && finish()} />
                {i > 0 && (
                  <Button disabled={busy} aria-label="Zeile entfernen" onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</Button>
                )}
              </span>
            </Field>
          ))}
          {lines.length < 10 && (
            <button type="button" onClick={() => setLines([...lines, ''])}
              className="touch-target self-start text-sm font-semibold text-accent underline">
              + Weiteren Ladevorgang eintragen (Ladung war unterbrochen)
            </button>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Summe: <strong>{invalid ? '–' : formatKwh(sumEnergy(finalParts))}</strong>
              {!invalid && finalParts.length > 1 && <span className="text-subtle"> ({formatEnergyParts(finalParts)})</span>}
            </span>
            <span className="flex gap-2">
              <Button disabled={busy} onClick={onCancelFinish}>Abbrechen</Button>
              <Button variant="primary" disabled={busy} onClick={finish}>Speichern & erledigt</Button>
            </span>
          </div>
        </div>
      )}

      <ErrorList errors={error ? [error] : []} />
    </section>
  )
}
