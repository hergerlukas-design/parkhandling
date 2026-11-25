import QRCode from 'qrcode'
import { useEffect, useState, type FormEvent } from 'react'
import { formatDateTime } from '../../lib/format'
import { scannerLink, scannerPinStatus, setScannerPin, validPin, type ScannerPinStatus } from '../../lib/helpers'
import { Button, ErrorList, Field, TextInput } from '../ui'

/** Admin: PIN des Scanner-Zugangs setzen; Adresse und QR-Code zum Aushängen */
export function ScannerPinSettings() {
  const [status, setStatus] = useState<ScannerPinStatus | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [svg, setSvg] = useState('')

  useEffect(() => {
    scannerPinStatus().then(setStatus).catch((e: Error) => setError(e.message))
    QRCode.toString(scannerLink(), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg(''))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setStatus(await setScannerPin(pin))
      setPin('')
      setNotice('PIN gespeichert. Wer heute schon angemeldet ist, bleibt es bis Tagesende.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-subtle">
        Unter <a className="font-medium underline" href={scannerLink()}>{scannerLink().replace(/^https?:\/\//, '')}</a> meldet
        man sich mit PIN und Namen an und kann bis Tagesende nur scannen, annehmen, einparken und zurückgeben.
      </p>
      <div className="text-sm">
        {status?.is_set
          ? <>PIN zuletzt geändert {status.updated_at ? formatDateTime(status.updated_at) : ''}{status.updated_by ? ` von ${status.updated_by}` : ''}</>
          : <span className="font-semibold text-danger">Noch keine PIN gesetzt – der Scanner ist gesperrt.</span>}
        {!!status?.failed_last_hour && (
          <span className="block text-xs text-danger">{status.failed_last_hour} falsche PIN-Eingaben in der letzten Stunde</span>
        )}
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Field label={status?.is_set ? 'Neue PIN (4 Ziffern)' : 'PIN (4 Ziffern)'} className="w-40">
          <TextInput inputMode="numeric" autoComplete="off" maxLength={4} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !validPin(pin)}>PIN speichern</Button>
      </form>
      <ErrorList errors={error ? [error] : []} />
      {notice && <p className="text-sm text-ok">{notice}</p>}
      {svg && (
        <div className="flex items-center gap-3">
          <div className="w-28 shrink-0 bg-white p-1 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-xs text-muted">QR-Code zum Scanner, z. B. zum Ausdrucken an der Annahme. Die PIN steht nicht darin.</p>
        </div>
      )}
    </div>
  )
}
