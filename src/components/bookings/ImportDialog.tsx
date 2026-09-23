import { useMemo, useState } from 'react'
import {
  createTabularAdapter,
  guessMapping,
  mappingProblems,
  readTable,
  TARGET_FIELDS,
  type ColumnMapping,
  type Table,
  type TargetField,
} from '../../booking-adapters'
import { upsertBooking } from '../../lib/bookings'
import { formatDateTime } from '../../lib/format'
import { PARKING_TYPE_LABEL, type ParkingType } from '../../types/domain'
import { Button, Dialog, ErrorList, Field, Select, TextInput } from '../ui'

const MAPPING_KEY = 'pf-import-mapping'

interface RowResult {
  row: number
  plate: string
  status: 'created' | 'updated' | 'unchanged' | 'invalid' | 'error'
  message?: string
}

const STATUS_LABEL: Record<RowResult['status'], string> = {
  created: 'Neu',
  updated: 'Umgebucht',
  unchanged: 'Unverändert',
  invalid: 'Ungültig',
  error: 'Fehler',
}

function loadSavedMapping(headers: string[]): ColumnMapping | null {
  try {
    const saved = JSON.parse(localStorage.getItem(MAPPING_KEY) ?? 'null') as
      | { headers: string[]; mapping: ColumnMapping }
      | null
    return saved && saved.headers.join('|') === headers.join('|') ? saved.mapping : null
  } catch {
    return null
  }
}

function saveMapping(headers: string[], mapping: ColumnMapping) {
  try {
    localStorage.setItem(MAPPING_KEY, JSON.stringify({ headers, mapping }))
  } catch {
    // ohne Speicher funktioniert der Import trotzdem
  }
}

/** CSV/Excel-Import mit Spaltenzuordnung, Vorprüfung und Ergebnisliste. */
export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [table, setTable] = useState<Table | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [source, setSource] = useState('csv')
  const [defaultParking, setDefaultParking] = useState<ParkingType | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<RowResult[] | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setResults(null)
    try {
      const t = await readTable(file)
      if (!t.headers.length || !t.rows.length) throw new Error('Datei enthält keine Datenzeilen.')
      setTable(t)
      setFileName(file.name)
      setMapping(loadSavedMapping(t.headers) ?? guessMapping(t.headers))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const adapter = useMemo(
    () => createTabularAdapter({ source: source.trim() || 'csv', mapping, defaultParkingType: defaultParking || null }),
    [source, mapping, defaultParking],
  )
  const checked = useMemo(() => (table ? table.rows.map((r) => adapter.normalize(r)) : []), [table, adapter])
  const validCount = checked.filter((r) => r.ok).length
  const problems = mappingProblems(defaultParking ? { ...mapping, parking_type: -1 } : mapping)
  const blocking = problems.filter((p) => !p.startsWith('Ohne Buchungsnummer'))

  async function runImport() {
    if (!table) return
    saveMapping(table.headers, mapping)
    const out: RowResult[] = []
    setProgress(0)
    for (let i = 0; i < checked.length; i++) {
      const r = checked[i]
      const row = i + 2 // Kopfzeile = Zeile 1
      if (!r.ok) {
        out.push({ row, plate: String(table.rows[i][mapping.plate ?? -1] ?? ''), status: 'invalid', message: r.errors.join(', ') })
      } else {
        try {
          const res = await upsertBooking(r.booking, adapter.source)
          const notes = [...r.warnings]
          if (res.unknown_services.length) notes.push(`Unbekannte Leistungen: ${res.unknown_services.join(', ')}`)
          out.push({ row, plate: r.booking.plate, status: res.action, message: notes.join(' · ') || undefined })
        } catch (e) {
          out.push({ row, plate: r.booking.plate, status: 'error', message: (e as Error).message })
        }
      }
      setProgress(i + 1)
    }
    setResults(out)
    setProgress(null)
    onDone()
  }

  const counts = results?.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})

  return (
    <Dialog
      title="Buchungen importieren"
      onClose={onClose}
      footer={
        results ? (
          <Button variant="primary" onClick={onClose}>Schließen</Button>
        ) : (
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" disabled={!table || blocking.length > 0 || validCount === 0 || progress !== null}
              onClick={() => void runImport()}>
              {progress !== null ? `Importiert ${progress}/${checked.length} …` : `${validCount} Buchungen importieren`}
            </Button>
          </>
        )
      }
    >
      {!results && (
        <div className="flex flex-col gap-4">
          <Field label="Datei (CSV oder Excel .xlsx)">
            <input type="file" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="touch-target text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:font-semibold" />
          </Field>
          {error && <ErrorList errors={[error]} />}

          {table && (
            <>
              <p className="text-sm text-slate-600">
                {fileName}: {table.rows.length} Zeilen, {table.headers.length} Spalten.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Quelle (für Wiedererkennung bei Umbuchungen)">
                  <TextInput value={source} onChange={(e) => setSource(e.target.value)} />
                </Field>
                <Field label="Parkart, falls keine Spalte">
                  <Select value={defaultParking} onChange={(e) => setDefaultParking(e.target.value as ParkingType | '')}>
                    <option value="">– aus Datei –</option>
                    {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Spaltenzuordnung</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(Object.keys(TARGET_FIELDS) as TargetField[]).map((field) => (
                    <Field key={field} label={TARGET_FIELDS[field]}>
                      <Select
                        value={mapping[field] ?? ''}
                        onChange={(e) =>
                          setMapping((prev) => {
                            const next = { ...prev }
                            if (e.target.value === '') delete next[field]
                            else next[field] = Number(e.target.value)
                            return next
                          })
                        }
                      >
                        <option value="">–</option>
                        {table.headers.map((h, i) => (
                          <option key={i} value={i}>{h || `Spalte ${i + 1}`}</option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              </fieldset>

              {problems.length > 0 && (
                <ul className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  Vorschau · {validCount} gültig, {checked.length - validCount} mit Fehlern
                </h3>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Zeile</th>
                        <th className="px-3 py-2">Kennzeichen</th>
                        <th className="px-3 py-2">Kunde</th>
                        <th className="px-3 py-2">Ankunft</th>
                        <th className="px-3 py-2">Abholung</th>
                        <th className="px-3 py-2">Prüfung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checked.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 text-slate-400">{i + 2}</td>
                          {r.ok ? (
                            <>
                              <td className="px-3 py-1.5 font-medium">{r.booking.plate}</td>
                              <td className="px-3 py-1.5">{r.booking.customer_name}</td>
                              <td className="px-3 py-1.5">{formatDateTime(r.booking.start_at)}</td>
                              <td className="px-3 py-1.5">{formatDateTime(r.booking.end_at)}</td>
                              <td className="px-3 py-1.5 text-emerald-700">{r.warnings.join(', ') || 'OK'}</td>
                            </>
                          ) : (
                            <td colSpan={5} className="px-3 py-1.5 text-red-700">{r.errors.join(', ')}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {checked.length > 20 && <p className="mt-1 text-xs text-slate-500">… und {checked.length - 20} weitere Zeilen</p>}
              </div>
            </>
          )}
        </div>
      )}

      {results && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {Object.entries(counts ?? {}).map(([k, n]) => (
              <span key={k} className="rounded-full bg-slate-100 px-3 py-1 font-medium">
                {STATUS_LABEL[k as RowResult['status']]}: {n}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <tbody>
                {results
                  .filter((r) => r.status !== 'unchanged')
                  .map((r) => (
                    <tr key={r.row} className="border-t border-slate-100 first:border-0">
                      <td className="px-3 py-1.5 text-slate-400">{r.row}</td>
                      <td className="px-3 py-1.5 font-medium">{r.plate}</td>
                      <td className={`px-3 py-1.5 ${r.status === 'invalid' || r.status === 'error' ? 'text-red-700' : ''}`}>
                        {STATUS_LABEL[r.status]}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{r.message}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  )
}
