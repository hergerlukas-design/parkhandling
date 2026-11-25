import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { formatDate } from '../lib/format'
import { APP_VERSION } from '../lib/version'
import { Icon } from './Icon'
import { isDayAccess, isDriverOnly, isHelperOnly, signOutToScanner, useAuth } from '../lib/auth'
import { BOTTOM_ITEMS, DRIVER_ITEMS, driverMayOpen, HELPER_ITEMS, helperMayOpen, NAV_ITEMS, SCAN_ENABLED, SETTINGS_ITEM } from './navigation'
import { UploadStatus } from './media/UploadStatus'
import { PushMessages } from './notifications/PushMessages'
import { UpdateBanner } from './UpdateBanner'
import { appearanceStore } from '../lib/appearance'
import { useStore } from '../lib/store'

/** Seitentitel für Ansichten ohne eigenen Navigationseintrag */
const EXTRA_TITLES = [
  { to: '/einchecken', label: 'Parken' },
  { to: '/scan', label: 'Scannen' },
  { to: '/changelog', label: 'Änderungen' },
]

const WEEKDAY = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short' })

function railClass(isActive: boolean) {
  return `touch-target flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium transition ${
    isActive ? 'bg-nav-active text-white' : 'text-white/70 hover:bg-nav-active/60 hover:text-white'
  }`
}

export function AppShell() {
  const { pathname } = useLocation()
  const { profile } = useAuth()
  const driverOnly = isDriverOnly(profile)
  const helperOnly = isHelperOnly(profile)
  const navItems = helperOnly ? HELPER_ITEMS : driverOnly ? DRIVER_ITEMS : NAV_ITEMS
  const bottomItems = helperOnly ? HELPER_ITEMS : driverOnly ? DRIVER_ITEMS : BOTTOM_ITEMS
  const home = helperOnly ? '/scan' : driverOnly ? '/shuttle' : '/'
  const current = [...NAV_ITEMS, SETTINGS_ITEM, ...EXTRA_TITLES].find((i) =>
    i.to === '/' ? pathname === '/' : pathname.startsWith(i.to),
  )
  const now = new Date()
  const website = useStore(appearanceStore) === 'website'

  // Reiner Fahrer: alles außer Shuttle und Einstellungen führt zur Shuttle-Ansicht
  if (driverOnly && !driverMayOpen(pathname)) return <Navigate to="/shuttle" replace />
  // Scanner-Zugang (PIN): nur Scannen, Annahme, Rückgabe, Einchecken
  if (helperOnly && !helperMayOpen(pathname)) return <Navigate to="/scan" replace />

  return (
    <div className="flex h-full flex-col">
      {/* Kopfzeile */}
      <header className="app-header flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 md:px-6 md:py-3">
        {website ? (
          <Link to={home} className="flex items-center gap-3" aria-label="ParkHandling – Startseite">
            <img src="/website/logo.png" alt="" width={300} height={254} className="h-9 w-auto md:h-11" />
          </Link>
        ) : (
          <Link to={home} className="text-lg font-bold tracking-tight md:text-xl">
            Park &amp; Fly
          </Link>
        )}
        <span className="app-title text-sm text-muted md:text-base">{current?.label}</span>
        <span className="hidden text-sm text-muted md:inline md:pl-4">
          {WEEKDAY.format(now).replace('.', '')}, {formatDate(now)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isDayAccess(profile) && (
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="hidden sm:inline">
                {helperOnly ? 'Scanner' : 'Tageszugang'} · {profile?.display_name} · bis Tagesende
              </span>
              <button type="button" onClick={() => void signOutToScanner()} className="rounded-full bg-chip px-3 py-1.5 font-semibold text-ink">
                Abmelden
              </button>
            </span>
          )}
          {!driverOnly && !helperOnly && SCAN_ENABLED && <NavLink
            to="/scan"
            className="btn-primary touch-target hidden items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark md:inline-flex"
          >
            <Icon name="scan" className="size-5" />
            Scannen
          </NavLink>}
          {!helperOnly && <NavLink
            to={SETTINGS_ITEM.to}
            aria-label={SETTINGS_ITEM.label}
            className="touch-target flex items-center justify-center rounded-full bg-chip text-ink md:hidden"
          >
            <Icon name={SETTINGS_ITEM.icon} className="size-5" />
          </NavLink>}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Seitenleiste (Tablet/Desktop) */}
        <nav aria-label="Hauptnavigation" className="app-rail hidden w-[76px] shrink-0 flex-col bg-nav px-1.5 py-3 md:flex">
          <ul className="flex flex-1 flex-col gap-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => railClass(isActive)}>
                  <Icon name={item.icon} className="size-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          {!helperOnly && <NavLink to={SETTINGS_ITEM.to} className={({ isActive }) => railClass(isActive)}>
            <Icon name={SETTINGS_ITEM.icon} className="size-5" />
            Setup
          </NavLink>}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <UploadStatus />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
          <footer className="hidden border-t border-line bg-surface px-4 py-1.5 text-right text-xs text-muted md:block">
            Park &amp; Fly Manager · Version {APP_VERSION}
          </footer>
        </div>
      </div>

      {/* Bottom-Bar (Smartphone) mit zentralem Scan-Button */}
      <nav aria-label="Hauptnavigation" className="app-bottom border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className={`grid items-end ${driverOnly ? 'grid-cols-1' : helperOnly ? 'grid-cols-2' : bottomItems.length === 6 ? 'grid-cols-6' : 'grid-cols-5'}`}>
          {bottomItems.map((item) =>
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
      <PushMessages />
    </div>
  )
}
