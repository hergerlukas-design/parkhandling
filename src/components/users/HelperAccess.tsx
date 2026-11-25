import QRCode from 'qrcode'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatTime } from '../../lib/format'
import { createHelperInvite, helperLink, listHelpers, revokeHelper, type ActiveHelper, type HelperInvite } from '../../lib/helpers'
import { Button, ErrorList, Field, TextInput } from '../ui'

/**
 * Tageszugang per QR: Name eingeben → QR-Code zeigen, die Person scannt ihn mit der Handykamera und hat
 * bis Tagesende Zugang zum ganzen Dashboard. Darunter alle heutigen Tageszugänge (QR und Scanner-PIN).
 */
export function HelperAccess() {
  const [name, setName] = useState('')
  const [invite, setInvite] = useState<(HelperInvite & { name: string; svg: string }) | null>(null)
  const [helpers, setHelpers] = useState<ActiveHelper[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const reload = useCallback(() => {
    listHelpers().then(setHelpers).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(reload, [reload])

  // Ablauf des Codes anzeigen; Liste nachladen, solange ein Code offen ist (Aushilfe erscheint nach dem Scan)
  useEffect(() => {
    if (!invite) return
    const t = setInterval(() => {
      setNow(Date.now())
      reload()
    }, 5000)
    return () => clearInterval(t)
  }, [invite, reload])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const inv = await createHelperInvite(name.trim())
      const svg = await QRCode.toString(helperLink(inv.code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      setInvite({ ...inv, name: name.trim(), svg })
      setName('')
      setNow(Date.now())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(h: ActiveHelper) {
    if (!confirm(`Zugang von ${h.display_name} jetzt beenden?`)) return
    try {
      await revokeHelper(h.id)
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const expired = invite ? new Date(invite.expires_at).getTime() <= now : false
  const redeemed = invite ? helpers.some((h) => h.display_name === invite.name) : false

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-subtle">
        Für Aushilfen ohne eigenes Konto: Namen eingeben, QR-Code zeigen, die Person scannt ihn mit der
        Handykamera und hat bis Tagesende Zugang zur ganzen App. Nur für Annahme, Einparken und Rückgabe
        reicht der Scanner mit PIN.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Field label="Name" className="min-w-0 flex-1">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Max Muster" minLength={2} maxLength={60} required />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2}>QR-Code erzeugen</Button>
      </form>
      <ErrorList errors={error ? [error] : []} />

      {invite && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-line p-4 text-center">
          {redeemed ? (
            <p className="text-sm font-semibold text-ok">{invite.name} ist freigeschaltet.</p>
          ) : expired ? (
            <p className="text-sm text-danger">Code abgelaufen. Bitte neu erzeugen.</p>
          ) : (
            <>
              <div className="w-56 max-w-full bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: invite.svg }} />
              <p className="text-sm font-semibold">{invite.name}</p>
              <p className="text-xs text-muted">
                Mit der Handykamera scannen · Code gültig bis {formatTime(invite.expires_at)} Uhr, nur einmal ·
                Zugang bis Tagesende
              </p>
            </>
          )}
          <Button onClick={() => setInvite(null)}>Schließen</Button>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-sm font-semibold">Heute angemeldet (Tageszugänge)</h3>
        {helpers.length === 0 ? (
          <p className="text-sm text-muted">Niemand mit Tageszugang angemeldet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {helpers.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{h.display_name}</span>
                  <span className="block text-xs text-muted">
                    {h.kind === 'scanner' ? 'Scanner (PIN)' : 'Ganze App (QR)'} · bis Tagesende{h.invited_by ? ` · freigeschaltet von ${h.invited_by}` : ''}
                  </span>
                </span>
                <Button variant="danger" onClick={() => void revoke(h)}>Sperren</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
