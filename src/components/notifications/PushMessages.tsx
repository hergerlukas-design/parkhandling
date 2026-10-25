import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../lib/auth'
import { syncPushSubscription } from '../../lib/push/pushClient'

interface Toast {
  id: number
  title: string
  body: string
  url: string
}

interface PushMessage {
  type?: string
  url?: string
  payload?: { title?: string; body?: string; url?: string }
}

const VISIBLE_MS = 8000
let nextId = 1

/**
 * Empfängt Nachrichten des Service Workers:
 *  - pf-push: Push bei geöffneter App → Hinweis unten statt Systembenachrichtigung
 *  - pf-navigate: Tippen auf eine Systembenachrichtigung → passende Ansicht öffnen
 * Gleicht außerdem einmal pro Anmeldung das Push-Abo des Geräts mit dem Konto ab.
 */
export function PushMessages() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [toasts, setToasts] = useState<Toast[]>([])
  const userId = session?.user.id

  useEffect(() => {
    if (userId) void syncPushSubscription().catch(() => undefined)
  }, [userId])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent<PushMessage>) => {
      const data = event.data
      if (data?.type === 'pf-navigate' && typeof data.url === 'string' && data.url.startsWith('/')) {
        navigate(data.url)
      } else if (data?.type === 'pf-push' && data.payload) {
        const toast: Toast = {
          id: nextId++,
          title: data.payload.title ?? 'Park & Fly',
          body: data.payload.body ?? '',
          url: data.payload.url?.startsWith('/') ? data.payload.url : '/',
        }
        setToasts((prev) => [...prev.slice(-2), toast])
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toast.id)), VISIBLE_MS)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex flex-col items-center gap-2 px-4 md:bottom-10 md:items-end md:px-6"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-xl"
        >
          <button
            type="button"
            onClick={() => {
              setToasts((prev) => prev.filter((x) => x.id !== t.id))
              navigate(t.url)
            }}
            className="touch-target min-w-0 flex-1 text-left"
          >
            <p className="truncate text-sm font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 line-clamp-2 text-sm text-white/80">{t.body}</p>}
          </button>
          <button
            type="button"
            aria-label="Hinweis schließen"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="touch-target -mr-2 flex items-center justify-center rounded-lg px-2 text-xl leading-none text-white/70 hover:text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
