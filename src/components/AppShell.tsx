import { NavLink, Outlet } from 'react-router'
import { APP_VERSION } from '../lib/version'
import { Icon } from './Icon'
import { NAV_ITEMS } from './navigation'
import { UpdateBanner } from './UpdateBanner'

export function AppShell() {
  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Seitenleiste (Tablet/Desktop) */}
      <nav
        aria-label="Hauptnavigation"
        className="hidden w-56 shrink-0 flex-col bg-nav text-slate-300 md:flex lg:w-64"
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div className="leading-tight">
            <div className="font-semibold text-white">Park &amp; Fly</div>
            <div className="text-xs text-slate-400">Manager</div>
          </div>
        </div>
        <ul className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `touch-target flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-nav-active text-white' : 'hover:bg-nav-active/60 hover:text-white'
                  }`
                }
              >
                <Icon name={item.icon} className="size-5" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <footer className="px-5 py-4 text-xs text-slate-500">Version {APP_VERSION}</footer>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <UpdateBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <footer className="hidden border-t border-slate-200 bg-white px-4 py-1.5 text-right text-xs text-slate-400 md:block">
          Park &amp; Fly Manager · Version {APP_VERSION}
        </footer>

        {/* Bottom-Bar (Smartphone) */}
        <nav
          aria-label="Hauptnavigation"
          className="border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <ul className="grid grid-cols-6">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `touch-target flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
                      isActive ? 'text-brand-600' : 'text-slate-500'
                    }`
                  }
                >
                  <Icon name={item.icon} className="size-5" />
                  <span className="max-w-full truncate px-0.5">{item.label.split('/')[0]}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="pb-1 text-center text-[10px] text-slate-400">Version {APP_VERSION}</div>
        </nav>
      </div>
    </div>
  )
}
