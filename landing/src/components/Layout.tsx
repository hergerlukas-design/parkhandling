import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'

export function Layout() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <Link to="/" className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span>
              Park &amp; Fly <span className="text-accent">München</span>
            </span>
          </Link>
          {pathname !== '/anfrage' && (
            <Link
              to="/anfrage"
              className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-ink hover:bg-white"
            >
              Anfragen
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-card text-sm text-ink-soft">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4">
          <span>© Park &amp; Fly München</span>
          <nav className="flex gap-4">
            <Link to="/impressum" className="inline-flex min-h-11 items-center hover:text-ink">
              Impressum
            </Link>
            <Link to="/datenschutz" className="inline-flex min-h-11 items-center hover:text-ink">
              Datenschutz
            </Link>
          </nav>
          <span data-testid="app-version">Version {__APP_VERSION__}</span>
        </div>
      </footer>
    </div>
  )
}
