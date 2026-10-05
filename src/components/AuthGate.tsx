import { useState, type FormEvent, type ReactNode } from 'react'
import { signIn, signOut, useAuth } from '../lib/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import { APP_VERSION } from '../lib/version'

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-nav p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-slate-500">Park &amp; Fly Manager · Version {APP_VERSION}</p>
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

  const input = 'touch-target w-full rounded-lg border border-slate-300 px-3 py-2 text-base'
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="touch-target mt-2 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
        {busy ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  )
}

/** Zugang nur für angemeldetes, freigeschaltetes Personal. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth()

  if (!isSupabaseConfigured) {
    return (
      <Screen title="Nicht konfiguriert">
        <p className="text-sm text-slate-600">
          VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen (siehe .env).
        </p>
      </Screen>
    )
  }
  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Lädt …</div>
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
        <p className="text-sm text-slate-600">
          Ihr Konto ({session.user.email}) muss von einem Admin freigeschaltet werden.
        </p>
        <button type="button" onClick={() => void signOut()}
          className="touch-target mt-4 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">
          Abmelden
        </button>
      </Screen>
    )
  }
  return <>{children}</>
}
