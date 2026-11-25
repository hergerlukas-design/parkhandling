import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ACCOUNT_ON_DEVICE, accessExpired, redeemHelperCode, redeemScannerPin, signIn, signOut, signOutToScanner, useAuth } from '../lib/auth'
import { codeFromHash, validPin } from '../lib/helpers'
import { isSupabaseConfigured } from '../lib/supabase'
import { SetPassword } from './users/SetPassword'
import { APP_VERSION } from '../lib/version'
import { APPEARANCE_OPTIONS, appearanceStore, setAppearance } from '../lib/appearance'
import { useStore } from '../lib/store'

function Screen({ title, children }: { title: string; children: ReactNode }) {
  const look = useStore(appearanceStore)
  const website = look === 'website'
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-nav p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          {website
            ? <img src="/website/logo.png" alt="ParkHandling" width={300} height={254} className="h-12 w-auto" />
            : <img src="/favicon.svg" alt="" className="size-10" />}
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-muted">Park &amp; Fly Manager · Version {APP_VERSION}</p>
          </div>
        </div>
        {children}
      </div>
      {/* Darstellung auch ohne Anmeldung wählbar: Scanner- und Tageszugänge sehen keine Einstellungen */}
      <div role="radiogroup" aria-label="Darstellung" className="flex gap-1 text-xs">
        {APPEARANCE_OPTIONS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={look === o.id} onClick={() => setAppearance(o.id)}
            className={`touch-target rounded-full px-3 ${look === o.id ? 'bg-nav-active font-semibold text-white' : 'text-white/60 hover:text-white'}`}>
            {o.label}
          </button>
        ))}
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
        className="btn-primary touch-target mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
        {busy ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  )
}

const NAME_KEY = 'pf-scanner-name'

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** /scanner: Anmeldung mit gemeinsamer PIN und Namen, bis Tagesende nur Scannen, Annahme, Einparken, Rückgabe */
function ScannerLogin() {
  const [pin, setPin] = useState('')
  const [name, setName] = useState(readName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await redeemScannerPin(pin, name.trim())
    if (!err) {
      try {
        localStorage.setItem(NAME_KEY, name.trim())
      } catch {
        // ohne Speicher: Name beim nächsten Mal neu eingeben
      }
      window.location.replace('/scan')
      return
    }
    setError(err)
    setPin('')
    setBusy(false)
  }

  const input = 'touch-target w-full rounded-lg border border-line-strong px-3 py-2 text-base'
  return (
    <Screen title="Scanner">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-subtle">Annahme, Einparken und Rückgabe. Anmeldung gilt bis Tagesende.</p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Ihr Name
          <input className={input} autoComplete="name" required minLength={2} maxLength={60} value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          PIN
          <input className={`${input} tracking-[0.5em]`} type="password" inputMode="numeric" autoComplete="off"
            pattern="[0-9]{4}" maxLength={4} required value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        {error === ACCOUNT_ON_DEVICE && (
          <button type="button" onClick={() => void signOut().then(() => window.location.reload())}
            className="touch-target rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold">
            Abmelden
          </button>
        )}
        <button type="submit" disabled={busy || !validPin(pin) || name.trim().length < 2}
          className="btn-primary touch-target mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
          {busy ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </Screen>
  )
}

/** /aushilfe#<Code>: Tageszugang zum ganzen Dashboard mit dem eigenen Handy (anonyme Anmeldung + Code einlösen) */
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
      if (!err) window.location.replace('/')
      else {
        setError(err)
        setBlocked(err === ACCOUNT_ON_DEVICE)
      }
    })
  }, [])

  return (
    <Screen title="Tageszugang">
      {!error && <p className="text-sm text-subtle">Wird freigeschaltet …</p>}
      {error && (
        <>
          <p className="text-sm text-danger">{error}</p>
          <p className="mt-2 text-sm text-subtle">
            {blocked ? 'Mit eigenem Konto braucht es keine Freischaltung.' : 'Bitte einen neuen QR-Code erzeugen lassen.'}
          </p>
          {blocked && (
            <button type="button" onClick={() => void signOut().then(() => window.location.reload())}
              className="touch-target mt-4 w-full rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold">
              Abmelden und mit dem QR-Code fortfahren
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
  if (isSupabaseConfigured && window.location.pathname === '/scanner') {
    if (loading) return <div className="flex h-full items-center justify-center text-sm text-muted">Lädt …</div>
    const dayAccessOk = !!profile?.active && !accessExpired(profile)
    // Eigenes Konto oder gültiger Tageszugang: weiter zur App (/scanner → /scan)
    if (!session || (session.user.is_anonymous && !dayAccessOk)) return <ScannerLogin />
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
        <a href="/scanner" className="touch-target mt-3 flex items-center justify-center text-sm text-subtle underline">
          Ohne Konto: Scanner mit PIN
        </a>
      </Screen>
    )
  }
  if (session.user.is_anonymous && (!profile?.active || accessExpired(profile))) {
    return (
      <Screen title="Zugang beendet">
        <p className="text-sm text-subtle">
          Der Tageszugang ist abgelaufen oder wurde beendet. Für die nächste Schicht neu anmelden: am Scanner mit PIN
          und Namen oder mit einem neuen QR-Code vom Personal.
        </p>
        <a href="/scanner"
          className="btn-primary touch-target mt-4 flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
          Zum Scanner
        </a>
        <button type="button" onClick={() => void signOutToScanner()}
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
