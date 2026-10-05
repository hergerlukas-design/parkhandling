import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { formatDate } from '../lib/format'
import { APP_VERSION } from '../lib/version'
import { Icon } from './Icon'
import { BOTTOM_ITEMS, NAV_ITEMS, SETTINGS_ITEM } from './navigation'
import { UpdateBanner } from './UpdateBanner'

const WEEKDAY = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short' })

function railClass(isActive: boolean) {
  return `touch-target flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium transition ${
    isActive ? 'bg-nav-active text-white' : 'text-white/70 hover:bg-nav-active/60 hover:text-white'
  }`
}

export function AppShell() {
  const { pathname } = useLocation()
  const current = [...NAV_ITEMS, SETTINGS_ITEM].find((i) =>
    i.to === '/' ? pathname === '/' : pathname.startsWith(i.to),
  )
  const now = new Date()

  return (
    <div className="flex h-full flex-col">
      {/* Kopfzeile */}
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 md:px-6 md:py-3">
        <Link to="/" className="text-lg font-bold tracking-tight md:text-xl">
          Park &amp; Fly
        </Link>
        <span className="text-sm text-muted md:text-base">{current?.label}</span>
        <span className="hidden text-sm text-muted md:inline md:pl-4">
          {WEEKDAY.format(now).replace('.', '')}, {formatDate(now)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <NavLink
            to="/scan"
            className="touch-target hidden items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark md:inline-flex"
          >
            <Icon name="scan" className="size-5" />
            Scannen
          </NavLink>
          <NavLink
            to={SETTINGS_ITEM.to}
            aria-label={SETTINGS_ITEM.label}
            className="touch-target flex items-center justify-center rounded-full bg-chip text-ink md:hidden"
          >
            <Icon name={SETTINGS_ITEM.icon} className="size-5" />
          </NavLink>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Seitenleiste (Tablet/Desktop) */}
        <nav aria-label="Hauptnavigation" className="hidden w-[76px] shrink-0 flex-col bg-nav px-1.5 py-3 md:flex">
          <ul className="flex flex-1 flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => railClass(isActive)}>
                  <Icon name={item.icon} className="size-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <NavLink to={SETTINGS_ITEM.to} className={({ isActive }) => railClass(isActive)}>
            <Icon name={SETTINGS_ITEM.icon} className="size-5" />
            Setup
          </NavLink>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
          <footer className="hidden border-t border-line bg-surface px-4 py-1.5 text-right text-xs text-muted md:block">
            Park &amp; Fly Manager · Version {APP_VERSION}
          </footer>
        </div>
      </div>

      {/* Bottom-Bar (Smartphone) mit zentralem Scan-Button */}
      <nav aria-label="Hauptnavigation" className="border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-5 items-end">
          {BOTTOM_ITEMS.map((item) =>
            item === 'scan' ? (
              <li key="scan" className="flex justify-center">
                <NavLink
                  to="/scan"
                  aria-label="Scannen"
                  className="-mt-7 flex size-14 items-center justify-center rounded-full bg-accent text-white shadow-lg ring-4 ring-surface"
                >
                  <Icon name="scan" className="size-7" />
                </NavLink>
              </li>
            ) : (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `touch-target flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium ${
                      isActive ? 'text-accent' : 'text-muted'
                    }`
                  }
                >
                  <Icon name={item.icon} className="size-5" />
                  <span className="max-w-full truncate px-0.5">{item.label}</span>
                </NavLink>
              </li>
            ),
          )}
        </ul>
        <div className="pb-1 text-center text-[10px] text-muted">Version {APP_VERSION}</div>
      </nav>
    </div>
  )
}
