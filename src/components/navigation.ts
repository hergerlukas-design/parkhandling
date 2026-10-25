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

export const SETTINGS_ITEM: NavItem = { to: '/einstellungen', label: 'Einstellungen', icon: 'settings' }

/** Smartphone: fünf Ziele plus zentraler Scan-Button; Einstellungen über das Zahnrad oben rechts. */
export const BOTTOM_ITEMS: (NavItem | 'scan')[] = [NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[2], 'scan', NAV_ITEMS[3], NAV_ITEMS[4]]
