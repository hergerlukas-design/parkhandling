/** Ereignisse für Push-Benachrichtigungen (Codes wie in der Migration 20261025000200). */
export const PUSH_EVENTS = [
  'booking_new',
  'booking_changed',
  'booking_review',
  'relocate_conflict',
  'arrival_soon',
  'pickup_soon',
  'booking_ready',
  'shuttle_due',
] as const

export type PushEvent = (typeof PUSH_EVENTS)[number]

export const PUSH_EVENT_LABEL: Record<PushEvent, { title: string; hint: string }> = {
  booking_new: { title: 'Neue Buchung', hint: 'Import, Parkos oder von Hand angelegt' },
  booking_changed: { title: 'Umbuchung & Storno', hint: 'Zeiten, Parkart oder Rückgabe geändert' },
  booking_review: { title: 'Import prüfen', hint: 'Parkos-Mail oder Buchung braucht eine Prüfung' },
  relocate_conflict: { title: 'Umsetzen nötig', hint: 'Regal-Konflikt und Erinnerung vor Fälligkeit' },
  arrival_soon: { title: 'Ankunft bald', hint: 'Kunde kommt in Kürze am Platz an' },
  pickup_soon: { title: 'Abholung bald', hint: 'Fahrzeug wird in Kürze abgeholt' },
  booking_ready: { title: 'Fahrzeug bereit', hint: 'Alle Aufgaben erledigt' },
  shuttle_due: { title: 'Shuttle fällig', hint: 'Fahrt startet in Kürze (eingeteilter Fahrer)' },
}

export type EventRoles = Array<'staff' | 'admin'>

export interface NotificationConfig {
  events: Partial<Record<PushEvent, { enabled?: boolean; roles?: EventRoles }>>
  arrival_lead_minutes?: number
  pickup_lead_minutes?: number
  relocate_reminder_minutes?: number
  shuttle_lead_minutes?: number
}

export const LEAD_FIELDS = [
  { key: 'arrival_lead_minutes', label: 'Ankunft bald', fallback: 60 },
  { key: 'pickup_lead_minutes', label: 'Abholung bald', fallback: 60 },
  { key: 'relocate_reminder_minutes', label: 'Umsetzen (vor Fälligkeit)', fallback: 60 },
  { key: 'shuttle_lead_minutes', label: 'Shuttle', fallback: 15 },
] as const

/** Ist das Ereignis für die Rolle vorgesehen? 'staff' = gesamtes Personal inkl. Admins. */
export function eventAppliesToRole(config: NotificationConfig, event: PushEvent, role: 'staff' | 'admin'): boolean {
  const cfg = config.events[event]
  if (!cfg || cfg.enabled === false) return false
  const roles = cfg.roles ?? ['staff']
  return roles.includes('staff') || roles.includes(role)
}

/** Ereignisse, die ein Gerät dieser Rolle abonnieren kann. */
export function availableEvents(config: NotificationConfig, role: 'staff' | 'admin'): PushEvent[] {
  return PUSH_EVENTS.filter((e) => eventAppliesToRole(config, e, role))
}

/** Schaltet ein Ereignis in der Liste eines Geräts um (sortiert, ohne Doppelte). */
export function toggleEvent(events: readonly string[], event: PushEvent, on: boolean): PushEvent[] {
  const set = new Set(events.filter((e): e is PushEvent => (PUSH_EVENTS as readonly string[]).includes(e)))
  if (on) set.add(event)
  else set.delete(event)
  return [...set].sort()
}
