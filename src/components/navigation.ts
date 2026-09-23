import type { IconName } from './Icon'

export interface NavItem {
  to: string
  label: string
  icon: IconName
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Heute', icon: 'today' },
  { to: '/lageplan', label: 'Lageplan', icon: 'map' },
  { to: '/fahrzeuge', label: 'Fahrzeuge', icon: 'car' },
  { to: '/aufgaben', label: 'Aufgaben', icon: 'tasks' },
  { to: '/shuttle', label: 'Shuttle/Vallet', icon: 'shuttle' },
  { to: '/einstellungen', label: 'Einstellungen', icon: 'settings' },
]
