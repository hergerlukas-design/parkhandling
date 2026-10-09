import { useState } from 'react'
import { keyHint, MOVE_TARGETS, moveVehicle, type MoveResult } from '../../lib/siteplan'
import { Button, Dialog, ErrorList, Field, TextInput } from '../ui'

/**
 * Auschecken / Umsetzen / Übergeben. Die Regeln (Auslagern von unten, Belegung, Kapazität)
 * prüft die Datenbank; Fehlermeldungen werden unverändert angezeigt.
 */
export function MoveDialog({
  bookingId,
  plate,
  fromCode,
  mode,
  onClose,
  onDone,
}: {
  bookingId: string
  plate: string
  fromCode: string | null
  mode: 'checkout' | 'relocate'
  onClose: () => void
  onDone: (result: MoveResult) => void
}) {
  const [target, setTarget] = useState<string | null | undefined>(mode === 'relocate' ? '' : undefined)
  const [otherCode, setOtherCode] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MoveResult | null>(null)
  const [busy, setBusy] = useState(false)

  const toCode = target === '' ? otherCode.trim().toUpperCase() || undefined : target
  const preset = MOVE_TARGETS.find((t) => t.code === target)

  async function submit() {
    if (toCode === undefined) return
    setBusy(true)
    setError(null)
    try {
      const res = await moveVehicle(bookingId, toCode, reason.trim() || preset?.reason || (mode === 'relocate' ? 'Umsetzen' : undefined))
      if (res.warnings.length || keyHint(res.from, res.to)) setResult(res)
      else onDone(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const hint = keyHint(result.from, result.to)
    return (
      <Dialog title="Bewegung gespeichert" onClose={() => onDone(result)}
        footer={<Button variant="primary" onClick={() => onDone(result)}>OK</Button>}>
        <p className="mb-2 text-sm">{plate}: {result.from ?? '–'} → {result.to ?? 'übergeben'}</p>
        {hint && <p className="mb-2 rounded-lg bg-accent-soft px-4 py-2 font-semibold text-accent-dark">{hint}</p>}
        {result.warnings.length > 0 && (
          <ul className="rounded-lg bg-warn-soft px-4 py-2 text-sm text-warn-ink">
            {result.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </Dialog>
    )
  }

  return (
    <Dialog
      title={`${mode === 'relocate' ? 'Umsetzen' : 'Auschecken'} · ${plate}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={busy || toCode === undefined} onClick={() => void submit()}>
            {busy ? 'Speichert …' : toCode === null ? 'Übergeben' : toCode ? `Nach ${toCode}` : 'Ziel wählen'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-subtle">Aktueller Ort: <strong className="font-mono">{fromCode ?? '–'}</strong></p>
      <div className="grid gap-2 sm:grid-cols-2">
        {MOVE_TARGETS.map((t) => (
          <button key={t.code ?? 'handover'} type="button" onClick={() => setTarget(t.code)}
            className={`touch-target rounded-xl border-2 px-3 py-2 text-left text-sm font-medium ${
              target === t.code ? 'border-accent bg-accent-soft' : 'border-line'
            } ${t.code === fromCode ? 'opacity-40' : ''}`}
            disabled={t.code === fromCode}>
            {t.label}
            {t.code && <span className="ml-2 font-mono text-xs text-muted">{t.code}</span>}
          </button>
        ))}
        <button type="button" onClick={() => setTarget('')}
          className={`touch-target rounded-xl border-2 px-3 py-2 text-left text-sm font-medium ${target === '' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
          Anderer Stellplatz
        </button>
      </div>
      {target === '' && (
        <Field label="Stellplatz-Code (z. B. R7-E3, A1-07, P-01)" className="mt-3">
          <TextInput value={otherCode} autoCapitalize="characters" onChange={(e) => setOtherCode(e.target.value)} />
        </Field>
      )}
      {target === null && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">
          Das Fahrzeug verlässt das Gelände, die Buchung wird abgeschlossen. Der Schlüssel geht mit.
          Das Übergabeprotokoll mit Unterschrift folgt in Schritt 10.
        </p>
      )}
      <Field label="Grund (optional)" className="mt-3">
        <TextInput value={reason} placeholder={preset?.reason ?? (mode === 'relocate' ? 'Umsetzen' : '')} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <div className="mt-3"><ErrorList errors={[error]} /></div>}
    </Dialog>
  )
}
