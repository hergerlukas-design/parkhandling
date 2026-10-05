import { registerSW } from 'virtual:pwa-register'
import { createStore } from '../store'
import { APP_VERSION, updateKind, type UpdateKind } from '../version'
import { flushDrafts } from './drafts'
import { isUpdateBlocked } from './updateGuard'

export const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000

export interface UpdateState {
  /** Neueste bekannte Version laut Server (`version.json`). */
  remoteVersion: string | null
  kind: UpdateKind
  /** Ein neuer Service Worker ist installiert und wartet auf Aktivierung. */
  swWaiting: boolean
  applying: boolean
  lastCheckedAt: string | null
  error: string | null
}

export const updateStore = createStore<UpdateState>({
  remoteVersion: null,
  kind: 'none',
  swWaiting: false,
  applying: false,
  lastCheckedAt: null,
  error: null,
})

let registration: ServiceWorkerRegistration | undefined
let activateWaitingSw: ((reload?: boolean) => Promise<void>) | undefined
let started = false

function patch(partial: Partial<UpdateState>) {
  updateStore.set((prev) => ({ ...prev, ...partial }))
}

async function fetchRemoteVersion(): Promise<string | null> {
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`version.json: HTTP ${res.status}`)
  const data = (await res.json()) as { version?: unknown }
  return typeof data.version === 'string' ? data.version : null
}

/** Prüft Service Worker und version.json auf eine neuere Version. */
export async function checkForUpdate(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  try {
    await registration?.update().catch(() => undefined)
    const remote = await fetchRemoteVersion()
    const kind = remote ? updateKind(APP_VERSION, remote) : 'none'
    patch({
      remoteVersion: remote,
      // Ein wartender Service Worker zählt auch dann als Update, wenn version.json
      // (z. B. durch einen Cache) noch nichts meldet.
      kind: kind === 'none' && updateStore.get().swWaiting ? 'patch' : kind,
      lastCheckedAt: new Date().toISOString(),
      error: null,
    })
  } catch (err) {
    patch({ lastCheckedAt: new Date().toISOString(), error: (err as Error).message })
  }
}

function waitForWaitingSw(timeoutMs: number): Promise<boolean> {
  if (updateStore.get().swWaiting) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      resolve(false)
    }, timeoutMs)
    const unsubscribe = updateStore.subscribe(() => {
      if (updateStore.get().swWaiting) {
        clearTimeout(timeout)
        unsubscribe()
        resolve(true)
      }
    })
  })
}

/**
 * Spielt das Update ein. Wird verweigert, solange ein Protokoll, eine Unterschrift
 * oder ein Check-in offen ist. Entwürfe werden vor dem Neuladen gesichert.
 */
export async function applyUpdate(): Promise<boolean> {
  if (isUpdateBlocked() || updateStore.get().applying) return false
  patch({ applying: true })
  try {
    await flushDrafts()
    if (!updateStore.get().swWaiting && registration) {
      // version.json ist schon neuer, der Service Worker lädt aber noch.
      await registration.update().catch(() => undefined)
      await waitForWaitingSw(30_000)
    }
    if (updateStore.get().swWaiting && activateWaitingSw) {
      await activateWaitingSw(true)
    } else {
      window.location.reload()
    }
    return true
  } catch (err) {
    patch({ applying: false, error: (err as Error).message })
    return false
  }
}

/** Einmalig beim App-Start aufrufen. */
export function startUpdateChecks(): void {
  if (started) return
  started = true

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    activateWaitingSw = registerSW({
      immediate: true,
      onNeedRefresh() {
        patch({ swWaiting: true })
        void checkForUpdate()
      },
      onRegisteredSW(_url, reg) {
        registration = reg
      },
      onRegisterError(err: unknown) {
        patch({ error: `Service Worker: ${String(err)}` })
      },
    })
  }

  void checkForUpdate()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate()
  })
  window.addEventListener('online', () => void checkForUpdate())
  setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS)
}
