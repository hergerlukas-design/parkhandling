import { useId, useState, type ReactNode } from 'react'

export function Page({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </header>
      {children}
    </div>
  )
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  )
}

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/**
 * Karte mit aufklappbarem Inhalt (z. B. Einstellungen). Der Zustand wird je Gerät gemerkt (storageKey).
 * Der Inhalt wird erst beim Aufklappen gerendert, lädt also auch erst dann seine Daten.
 */
export function CollapsibleCard({
  title,
  storageKey,
  defaultOpen = false,
  children,
}: {
  title: string
  storageKey: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const key = `pf-card-open:${storageKey}`
  const [open, setOpen] = useState(() => readOpen(key, defaultOpen))
  const bodyId = useId()

  function toggle() {
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1')
      } catch {
        // ohne Speicher: Zustand gilt nur bis zum Neuladen
      }
      return !o
    })
  }

  return (
    <section className="rounded-2xl border border-line bg-white shadow-sm">
      <h2 className="text-base font-semibold">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
          className="touch-target flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <span>{title}</span>
          <span aria-hidden="true" className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>
      </h2>
      {open && <div id={bodyId} className="border-t border-line p-4">{children}</div>}
    </section>
  )
}

export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-subtle">{children}</p>
      <p className="mt-2 text-xs text-muted">Folgt in Phase 1.</p>
    </Card>
  )
}
