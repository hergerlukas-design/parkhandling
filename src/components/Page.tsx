import type { ReactNode } from 'react'

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

export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <Card>
      <p className="text-sm text-subtle">{children}</p>
      <p className="mt-2 text-xs text-muted">Folgt in Phase 1.</p>
    </Card>
  )
}
