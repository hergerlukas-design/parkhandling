import { useState, type FormEvent, type ReactNode } from 'react'
import { signIn, signOut, useAuth } from '../lib/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import { requestPasswordReset } from '../lib/users'
import { SetPassword } from './users/SetPassword'
import { APP_VERSION } from '../lib/version'

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-nav p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-muted">Park &amp; Fly Manager · Version {APP_VERSION}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

const input = 'touch-target w-full rounded-lg border border-line-strong px-3 py-2 text-base'
const linkButton = 'touch-target self-center text-sm font-medium text-accent hover:underline'

/** Abgelaufener oder schon benutzter Link aus Einladung/Passwort-Mail (Fehler steht in der Adresse). */
function linkErrorFromUrl(): string | null {
  const params = new URLSearchParams(`${window.location.search.slice(1)}&${window.location.hash.slice(1)}`)
  if (!params.get('error_code') && !params.get('error')) return null
  return 'Der Link ist abgelaufen oder wurde schon benutzt. Bitte mit Passwort anmelden oder über „Passwort vergessen?“ einen neuen Link anfordern.'
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(linkErrorFromUrl)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(await signIn(email.trim(), password))
    setBusy(false)
  }

  if (forgot) return <ForgotPasswordForm email={email} onEmail={setEmail} onBack={() => setForgot(false)} />

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        E-Mail
        <input className={input} type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Passwort
        <input className={input} type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy}
        className="touch-target mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
        {busy ? 'Anmelden …' : 'Anmelden'}
      </button>
      <button type="button" className={linkButton} onClick={() => { setError(null); setForgot(true) }}>
        Passwort vergessen?
      </button>
    </form>
  )
}

/** Link zum Zurücksetzen anfordern; die Antwort verrät nicht, ob ein Konto existiert. */
function ForgotPasswordForm({ email, onEmail, onBack }: {
  email: string
  onEmail: (email: string) => void
  onBack: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const result = await requestPasswordReset(email)
    setBusy(false)
    setError(result)
    setSent(!result)
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-subtle">
          Falls ein Konto für <strong>{email.trim()}</strong> besteht, kommt in wenigen Minuten eine E-Mail mit einem Link.
          Darüber vergeben Sie ein neues Passwort. Bitte auch den Spam-Ordner prüfen.
        </p>
        <button type="button" className={linkButton} onClick={onBack}>Zurück zur Anmeldung</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-subtle">E-Mail-Adresse eingeben. Sie erhalten einen Link, um ein neues Passwort zu vergeben.</p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        E-Mail
        <input className={input} type="email" autoComplete="username" required value={email}
          onChange={(e) => onEmail(e.target.value)} />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy}
        className="touch-target mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
        {busy ? 'Sende …' : 'Link senden'}
      </button>
      <button type="button" className={linkButton} onClick={onBack}>Zurück zur Anmeldung</button>
    </form>
  )
}

/** Zugang nur für angemeldetes, freigeschaltetes Personal. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()

  if (!isSupabaseConfigured) {
    return (
      <Screen title="Nicht konfiguriert">
        <p className="text-sm text-subtle">
          VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen (siehe .env).
        </p>
      </Screen>
    )
  }
  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Lädt …</div>
  }
  if (!session) {
    return (
      <Screen title="Anmelden">
        <LoginForm />
      </Screen>
    )
  }
  if (!profile?.active) {
    return (
      <Screen title="Konto nicht freigeschaltet">
        <p className="text-sm text-subtle">
          Ihr Konto ({session.user.email}) muss von einem Admin freigeschaltet werden.
        </p>
        <button type="button" onClick={() => void signOut()}
          className="touch-target mt-4 w-full rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold">
          Abmelden
        </button>
      </Screen>
    )
  }
  // Nach Einladung oder Passwort-Link: Passwort festlegen, bevor das Dashboard erscheint (auch über /passwort)
  if (profile.must_change_password || window.location.pathname === '/passwort') {
    return (
      <Screen title="Passwort festlegen">
        <SetPassword onDone={() => window.location.assign('/')} />
      </Screen>
    )
  }
  return <>{children}</>
}
