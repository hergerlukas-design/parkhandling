import type { IconName } from './Icon'

export interface NavItem {
  to: string
  label: string
  icon: IconName
}

/** Hauptnavigation */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'today' },
  { to: '/lageplan', label: 'Lageplan', icon: 'map' },
  { to: '/fahrzeuge', label: 'Fahrzeuge', icon: 'car' },
  { to: '/aufgaben', label: 'Aufgaben', icon: 'tasks' },
  { to: '/shuttle', label: 'Shuttle', icon: 'shuttle' },
]

/** Reiner Fahrer: nur Shuttle (Einstellungen über das Zahnrad bzw. die Seitenleiste) */
export const DRIVER_ITEMS: NavItem[] = [{ to: '/shuttle', label: 'Shuttle', icon: 'shuttle' }]

/** Seiten, die ein reiner Fahrer öffnen darf */
export const DRIVER_PATHS = ['/shuttle', '/einstellungen', '/changelog', '/passwort']

export function driverMayOpen(pathname: string): boolean {
  return DRIVER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export const SETTINGS_ITEM: NavItem = { to: '/einstellungen', label: 'Einstellungen', icon: 'settings' }

/** Zentraler Scan-Button (Kopfzeile und Smartphone-Leiste). Vorerst aus, wird nicht genutzt; Seite /scan bleibt erreichbar. */
export const SCAN_ENABLED = false

/** Smartphone: fünf Ziele (plus zentraler Scan-Button, falls aktiv); Einstellungen über das Zahnrad oben rechts. */
export const BOTTOM_ITEMS: (NavItem | 'scan')[] = SCAN_ENABLED
  ? [NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[2], 'scan', NAV_ITEMS[3], NAV_ITEMS[4]]
  : NAV_ITEMS
