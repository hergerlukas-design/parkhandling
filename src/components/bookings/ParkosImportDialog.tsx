import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  countDays,
  IMPORT_FLAG_LABEL,
  MAIL_TYPE_LABEL,
  parseParkosMail,
  type ImportFlag,
  type ParkosOptions,
} from '../../booking-adapters'
import { formatDateTime, formatMoney } from '../../lib/format'
import {
  IMPORT_STATUS_LABEL,
  IMPORT_STATUS_STYLE,
  importParkosMail,
  loadParkosOptions,
  type ImportResult,
} from '../../lib/imports'
import { LANGUAGE_LABEL, PARKING_TYPE_LABEL, RETURN_MODE_LABEL, type ParkingType } from '../../types/domain'
import { Button, Dialog, ErrorList, Field, Select } from '../ui'

/** Hinweise, bei denen die Datenbank nichts anlegt, sondern zur Prüfung ablegt */
const REVIEW_FLAGS: ImportFlag[] = ['unknown_product', 'sender_unverified']
const MAX_FILE_BYTES = 2_000_000

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || '–'}</dd>
    </div>
  )
}

/**
 * Parkos-Bestätigungsmail einfügen oder als .eml hochladen → Vorschau → übernehmen.
 * Parser und Datenbankfunktion sind dieselben wie beim späteren automatischen IMAP-Abruf.
 */
export function ParkosImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate()
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [options, setOptions] = useState<ParkosOptions | null>(null)
  const [override, setOverride] = useState<ParkingType | ''>('')
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    loadParkosOptions()
      .then(setOptions)
      .catch((e: Error) => setErrors([`Einstellungen nicht geladen: ${e.message}`]))
  }, [])

  const parsed = useMemo(
    () => (options && raw.trim() ? parseParkosMail(raw, { ...options, parkingTypeOverride: override || null }) : null),
    [raw, options, override],
  )
  const needsOverride = !!parsed && (parsed.flags.includes('unknown_product') || parsed.flags.includes('parking_type_manual'))
  const willReview =
    !!parsed && (parsed.mailType !== 'new' || !parsed.booking || parsed.flags.some((f) => REVIEW_FLAGS.includes(f)))

  async function onFile(file: File | undefined) {
    if (!file) return
    setErrors([])
    setResult(null)
    if (file.size > MAX_FILE_BYTES) {
      setErrors(['Datei ist zu groß (max. 2 MB). Bitte nur die Mail ohne Anhänge speichern.'])
      return
    }
    setRaw(await file.text())
    setFileName(file.name)
  }

  async function submit() {
    if (!parsed) return
    setSaving(true)
    setErrors([])
    try {
      setResult(await importParkosMail(parsed))
      onDone()
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setRaw('')
    setFileName(null)
    setOverride('')
    setResult(null)
    setErrors([])
  }

  const b = parsed?.booking
  const f = parsed?.fields

  return (
    <Dialog
      title="Parkos-Mail importieren"
      onClose={onClose}
      footer={
        result ? (
          <>
            <Button onClick={reset}>Weitere Mail</Button>
            {result.booking_id ? (
              <Button variant="primary" onClick={() => navigate(`/fahrzeuge/${result.booking_id}`)}>Zur Buchung</Button>
            ) : (
              <Button variant="primary" onClick={onClose}>Schließen</Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" disabled={!parsed || saving}
              onClick={() => void submit()}>
              {saving ? 'Speichert …' : willReview ? 'Zur Prüfung ablegen' : 'Buchung übernehmen'}
            </Button>
          </>
        )
      }
    >
      {errors.length > 0 && (
        <div className="mb-3">
          <ErrorList errors={errors} />
        </div>
      )}

      {result ? (
        <div className="flex flex-col gap-3">
          <p>
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${IMPORT_STATUS_STYLE[result.status]}`}>
              {IMPORT_STATUS_LABEL[result.status]}
            </span>
          </p>
          {result.status === 'imported' && <p className="text-sm">Die Buchung wurde angelegt.</p>}
          {result.status === 'updated' && <p className="text-sm">Die Buchung gab es schon, sie wurde aktualisiert (siehe Buchungshistorie).</p>}
          {result.status === 'unchanged' && <p className="text-sm">Diese Mail war bereits importiert, nichts geändert.</p>}
          {result.error && <p className="text-sm text-subtle">{result.error}</p>}
          {(result.status === 'needs_review' || result.status === 'failed') && (
            <p className="text-sm text-subtle">Die Mail liegt in der Prüfliste unter „Fahrzeuge → Importe prüfen“.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Mail einfügen (alles markieren und kopieren)">
            <textarea
              rows={raw ? 4 : 8}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setFileName(null)
              }}
              placeholder="Reservierung bei Parkos #… – kompletten Mailtext hier einfügen"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-xs"
            />
          </Field>
          <Field label="oder Mail-Datei (.eml, .html, .txt)">
            <input type="file" accept=".eml,.html,.htm,.txt,message/rfc822,text/html,text/plain"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="touch-target text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-chip file:px-4 file:py-2 file:font-semibold" />
          </Field>
          {fileName && <p className="-mt-2 text-xs text-muted">Geladen: {fileName}</p>}

          {parsed && f && (
            <section className="rounded-xl border border-line p-3">
              <header className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-chip px-3 py-1 text-xs font-semibold">{MAIL_TYPE_LABEL[parsed.mailType]}</span>
                {parsed.externalRef && <span className="font-mono text-sm font-semibold">#{parsed.externalRef}</span>}
                {parsed.flags.map((flag) => (
                  <span key={flag} className="rounded-full bg-warn-soft px-3 py-1 text-xs font-semibold text-warn-ink">
                    {IMPORT_FLAG_LABEL[flag]}
                  </span>
                ))}
              </header>

              {parsed.mailType !== 'new' && (
                <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">
                  {parsed.mailType === 'unknown'
                    ? 'Das sieht nicht nach einer Parkos-Reservierung aus. Die Mail wird nur zur Prüfung abgelegt.'
                    : `${MAIL_TYPE_LABEL[parsed.mailType]} erkannt. Solche Mails werden noch nicht automatisch übernommen, sondern zur Prüfung abgelegt.`}
                </p>
              )}
              {parsed.errors.length > 0 && (
                <div className="mb-3">
                  <ErrorList errors={parsed.errors} />
                </div>
              )}
              {parsed.flags.includes('sender_unverified') && (
                <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">
                  Absender {parsed.sender ?? 'unbekannt'} ist nicht Parkos. Die Mail wird nur zur Prüfung abgelegt.
                </p>
              )}

              {needsOverride && parsed.mailType === 'new' && (
                <Field label={`Parkform „${f.parkform ?? '–'}“ ist unbekannt – Parkart wählen`} className="mb-3">
                  <Select value={override} onChange={(e) => setOverride(e.target.value as ParkingType | '')}>
                    <option value="">– zur Prüfung ablegen –</option>
                    {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </Select>
                </Field>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
                <Item label="Kunde">{f.customerName}</Item>
                <Item label="Telefon">{f.customerPhone}</Item>
                <Item label="E-Mail">{f.customerEmail}</Item>
                <Item label="Kennzeichen">
                  {b ? <span className="font-mono font-semibold">{b.plate}</span> : f.plateRaw}
                  {b && f.plateRaw && b.plate !== f.plateRaw && <span className="text-xs text-muted"> (Mail: {f.plateRaw})</span>}
                </Item>
                <Item label="Fahrzeug">{f.vehicleModel}</Item>
                <Item label="Personen">{f.persons}</Item>
                <Item label="Parkform">{f.parkform}</Item>
                <Item label="Parkart · Rückgabe">
                  {b && !parsed.flags.includes('unknown_product')
                    ? `${PARKING_TYPE_LABEL[b.parking_type]} · ${b.return_mode ? RETURN_MODE_LABEL[b.return_mode] : '–'}`
                    : ''}
                </Item>
                <Item label="Transfer">{f.transfer}</Item>
                <Item label="Ankunft Parkplatz">{b ? formatDateTime(b.start_at) : [f.arrivalDate, f.arrivalTime].filter(Boolean).join(' ')}</Item>
                <Item label="Landung Rückflug">{b?.return_flight_at ? formatDateTime(b.return_flight_at) : [f.returnDate, f.returnTime].filter(Boolean).join(' ')}</Item>
                <Item label={`Abholung (+${options?.bufferMinutes ?? 60} min)`}>
                  {b ? <strong>{formatDateTime(b.end_at)}</strong> : ''}
                </Item>
                <Item label="Flüge">{[f.flightOut, f.flightReturn].filter(Boolean).join(' / ')}</Item>
                <Item label="Tage">{b ? countDays(b.start_at, b.end_at) : ''}</Item>
                <Item label="Sprache">{b?.customer_language ? LANGUAGE_LABEL[b.customer_language] ?? b.customer_language : f.language}</Item>
                <Item label="Preis Kunde">{f.totalCustomer != null ? formatMoney(f.totalCustomer) : ''}</Item>
                <Item label="Auszahlung">{f.payout != null ? formatMoney(f.payout) : ''}</Item>
                <Item label="Zahlung">{f.paidInAdvance ? 'Bezahlt (bei Parkos)' : 'Offen'}</Item>
              </dl>
            </section>
          )}
        </div>
      )}
    </Dialog>
  )
}
