/** Ereignisse für Push-Benachrichtigungen (Codes wie in den Migrationen 20261025000200 und 20261026000100). */
export const PUSH_EVENTS = [
  'booking_new',
  'booking_changed',
  'booking_review',
  'relocate_conflict',
  'arrival_soon',
  'pickup_soon',
  'booking_ready',
  'shuttle_due',
  'charging_ended',
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
  charging_ended: { title: 'Ladung beendet', hint: 'Fahrzeug vom Ladeplatz holen' },
}

export type EventRole = 'staff' | 'admin' | 'driver'
export type EventRoles = EventRole[]

export const EVENT_ROLE_LABEL: Record<EventRole, string> = { staff: 'Personal', admin: 'Admins', driver: 'Fahrer' }
export const EVENT_ROLES: EventRole[] = ['staff', 'admin', 'driver']

/** Konto-Rollen → Empfänger-Rollen: Admins zählen auch als Personal */
export function recipientRoles(roles: readonly string[]): EventRole[] {
  const set = new Set(roles.filter((r): r is EventRole => (EVENT_ROLES as string[]).includes(r)))
  if (set.has('admin')) set.add('staff')
  return [...set]
}

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

/**
 * Ist das Ereignis für ein Konto mit diesen Rollen vorgesehen?
 * Empfänger 'staff' = Personal inkl. Admins, 'admin' = nur Admins, 'driver' = Fahrer.
 */
export function eventAppliesToRole(config: NotificationConfig, event: PushEvent, roles: string | readonly string[]): boolean {
  const cfg = config.events[event]
  if (!cfg || cfg.enabled === false) return false
  const targets = cfg.roles ?? ['staff']
  const mine = recipientRoles(typeof roles === 'string' ? [roles] : roles)
  return targets.some((t) => mine.includes(t))
}

/** Ereignisse, die ein Gerät mit diesen Rollen abonnieren kann. */
export function availableEvents(config: NotificationConfig, roles: string | readonly string[]): PushEvent[] {
  return PUSH_EVENTS.filter((e) => eventAppliesToRole(config, e, roles))
}

/** Schaltet ein Ereignis in der Liste eines Geräts um (sortiert, ohne Doppelte). */
export function toggleEvent(events: readonly string[], event: PushEvent, on: boolean): PushEvent[] {
  const set = new Set(events.filter((e): e is PushEvent => (PUSH_EVENTS as readonly string[]).includes(e)))
  if (on) set.add(event)
  else set.delete(event)
  return [...set].sort()
}
