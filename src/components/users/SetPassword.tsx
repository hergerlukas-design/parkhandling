import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH, setPassword } from '../../lib/users'
import { Button, ErrorList, Field, TextInput } from '../ui'

/** Ziel des Einladungslinks (/passwort): Passwort festlegen, danach ins Dashboard. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setValue] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== repeat) return setError('Die Passwörter stimmen nicht überein.')
    setBusy(true)
    const result = await setPassword(password)
    setBusy(false)
    if (result) return setError(result)
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-subtle">Bitte ein Passwort für Ihr Konto festlegen.</p>
      <Field label={`Passwort (mind. ${MIN_PASSWORD_LENGTH} Zeichen)`}>
        <TextInput type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH}
          value={password} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label="Passwort wiederholen">
        <TextInput type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH}
          value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <ErrorList errors={error ? [error] : []} />
      <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Speichere …' : 'Passwort speichern'}</Button>
    </form>
  )
}
