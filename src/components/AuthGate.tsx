import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { accessExpired, redeemHelperCode, signIn, signOut, useAuth } from '../lib/auth'
import { codeFromHash } from '../lib/helpers'
import { isSupabaseConfigured } from '../lib/supabase'
import { SetPassword } from './users/SetPassword'
import { APP_VERSION } from '../lib/version'

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-nav p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
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

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(await signIn(email.trim(), password))
    setBusy(false)
  }

  const input = 'touch-target w-full rounded-lg border border-line-strong px-3 py-2 text-base'
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
    </form>
  )
}

/** /aushilfe#<Code>: Aushilfe mit dem eigenen Handy freischalten (anonyme Anmeldung + Code einlösen) */
function HelperRedeem() {
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const code = codeFromHash(window.location.hash)
    if (!code) {
      setError('Der Link enthält keinen gültigen Freischalt-Code.')
      return
    }
    redeemHelperCode(code).then((err) => {
      if (!err) window.location.replace('/scan')
      else {
        setError(err)
        setBlocked(err.startsWith('Auf diesem Gerät'))
      }
    })
  }, [])

  return (
    <Screen title="Aushilfe freischalten">
      {!error && <p className="text-sm text-subtle">Wird freigeschaltet …</p>}
      {error && (
        <>
          <p className="text-sm text-danger">{error}</p>
          <p className="mt-2 text-sm text-subtle">
            {blocked ? 'Festes Personal braucht keine Freischaltung.' : 'Bitte einen neuen QR-Code erzeugen lassen.'}
          </p>
          {blocked && (
            <button type="button" onClick={() => void signOut().then(() => window.location.reload())}
              className="touch-target mt-4 w-full rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold">
              Abmelden und als Aushilfe fortfahren
            </button>
          )}
        </>
      )}
    </Screen>
  )
}

/** Zugang nur für angemeldetes, freigeschaltetes Personal (oder freigeschaltete Aushilfen). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()

  if (isSupabaseConfigured && window.location.pathname === '/aushilfe') {
    return <HelperRedeem />
  }

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
  if (session.user.is_anonymous && (!profile?.active || accessExpired(profile))) {
    return (
      <Screen title="Zugang beendet">
        <p className="text-sm text-subtle">
          Der Aushilfen-Zugang ist abgelaufen oder wurde beendet. Für die nächste Schicht bitte einen neuen QR-Code
          beim Personal scannen.
        </p>
        <button type="button" onClick={() => void signOut()}
          className="touch-target mt-4 w-full rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold">
          Abmelden
        </button>
      </Screen>
    )
  }
  if (!profile?.active || accessExpired(profile)) {
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
  // Nach Einladung: Passwort festlegen, bevor das Dashboard erscheint (auch über /passwort)
  if (profile.must_change_password || window.location.pathname === '/passwort') {
    return (
      <Screen title="Passwort festlegen">
        <SetPassword onDone={() => window.location.assign('/')} />
      </Screen>
    )
  }
  return <>{children}</>
}
