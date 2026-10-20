import { useEffect, useState } from 'react'
import { formatBytes, formatDate, formatDateTime } from '../../lib/format'
import {
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  listRetentionRuns,
  loadRetentionConfig,
  loadRetentionPreview,
  runRetentionNow,
  saveRetentionConfig,
  type RetentionConfig,
  type RetentionPreview,
  type RetentionRun,
} from '../../lib/retention'
import { Button, Dialog, ErrorList, Field, TextInput } from '../ui'

/**
 * Aufbewahrung von Vollbild-Fotos: Frist, täglicher Job (Standard aus), Vorschau und Protokoll.
 * Thumbnails, Unterschriften und PDF-Protokolle bleiben immer erhalten.
 */
export function RetentionSettings() {
  const [config, setConfig] = useState<RetentionConfig | null>(null)
  const [days, setDays] = useState('')
  const [preview, setPreview] = useState<RetentionPreview | null>(null)
  const [runs, setRuns] = useState<RetentionRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmRun, setConfirmRun] = useState(false)

  async function reload() {
    try {
      const [c, p, r] = await Promise.all([loadRetentionConfig(), loadRetentionPreview(), listRetentionRuns()])
      setConfig(c)
      setDays(String(c.days))
      setPreview(p)
      setRuns(r)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => void reload(), [])

  async function save(next: RetentionConfig, message: string) {
    setSaving(true)
    setError(null)
    setDone(null)
    try {
      await saveRetentionConfig(next)
      setDone(message)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    setSaving(true)
    setError(null)
    setDone(null)
    try {
      const r = await runRetentionNow()
      setDone(`${r.deleted} Vollbilder gelöscht${r.failed ? `, ${r.failed} fehlgeschlagen` : ''}.`)
      if (r.error) setError(r.error)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConfirmRun(false)
      setSaving(false)
    }
  }

  if (!config) return error ? <ErrorList errors={[error]} /> : <p className="text-sm text-muted">Lädt …</p>

  const parsedDays = Number(days)
  const daysChanged = parsedDays !== config.days

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-subtle">
        Vollbild-Fotos werden {config.days} Tage nach Ende einer abgeschlossenen oder stornierten Buchung gelöscht.
        Vorschaubilder, Unterschriften und PDF-Protokolle bleiben erhalten, Kundendaten werden nicht verändert.
      </p>
      <ErrorList errors={error ? [error] : []} />
      {done && <p className="rounded-lg bg-ok-soft px-4 py-2 text-ok-ink">{done}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Frist in Tagen" className="w-40">
          <TextInput
            type="number"
            inputMode="numeric"
            min={RETENTION_MIN_DAYS}
            max={RETENTION_MAX_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        {daysChanged && (
          <Button disabled={saving} onClick={() => void save({ ...config, days: parsedDays }, 'Frist gespeichert.')}>
            Frist speichern
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-y border-line py-2">
        <span>
          Täglicher Lösch-Job (03:15 Uhr UTC):{' '}
          <strong className={config.enabled ? 'text-ok-ink' : 'text-muted'}>{config.enabled ? 'an' : 'aus'}</strong>
        </span>
        <Button
          variant={config.enabled ? 'secondary' : 'primary'}
          disabled={saving}
          onClick={() =>
            void save(
              { ...config, enabled: !config.enabled },
              config.enabled ? 'Lösch-Job ausgeschaltet.' : 'Lösch-Job eingeschaltet, läuft ab heute Nacht.',
            )
          }
        >
          {config.enabled ? 'Ausschalten' : 'Einschalten'}
        </Button>
      </div>

      {preview && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Jetzt fällig: <strong>{preview.dueCount}</strong> Vollbilder ({formatBytes(preview.dueBytes)})
            {preview.oldestEndAt && <span className="text-muted"> · älteste Buchung endete {formatDate(preview.oldestEndAt)}</span>}
          </span>
          {preview.dueCount > 0 && (
            <Button variant="danger" disabled={saving} onClick={() => setConfirmRun(true)}>
              Jetzt löschen
            </Button>
          )}
        </div>
      )}

      {runs.length > 0 && (
        <div>
          <h3 className="mb-1 font-semibold">Letzte Läufe</h3>
          <ul className="flex flex-col gap-1">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 text-subtle">
                <span>
                  {formatDateTime(r.started_at)} · {r.trigger === 'cron' ? 'automatisch' : 'manuell'}
                </span>
                <span className={r.error ? 'text-danger-ink' : ''}>
                  {r.finished_at ? `${r.deleted_count} gelöscht (${formatBytes(r.freed_bytes)})` : 'läuft / abgebrochen'}
                  {r.failed_count > 0 && ` · ${r.failed_count} Fehler`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmRun && preview && (
        <Dialog
          title="Vollbilder jetzt löschen?"
          onClose={() => setConfirmRun(false)}
          footer={
            <>
              <Button onClick={() => setConfirmRun(false)}>Abbrechen</Button>
              <Button variant="danger" disabled={saving} onClick={() => void runNow()}>
                {saving ? 'Wird gelöscht …' : `${preview.dueCount} Vollbilder löschen`}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {preview.dueCount} Vollbild-Fotos ({formatBytes(preview.dueBytes)}) werden endgültig gelöscht. Die
            Vorschaubilder bleiben sichtbar. Das lässt sich nicht rückgängig machen.
          </p>
        </Dialog>
      )}
    </div>
  )
}
