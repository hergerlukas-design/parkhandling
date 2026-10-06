import { formatDate, formatTime, TIME_ZONE } from './format'

/** Farbstufe nach Abholdatum (Lageplan, Listen) – wie im Klick-Prototyp. */
export type DueCategory = 'today' | 'tomorrow' | 'week' | 'later'

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** Kalendertag in Europe/Berlin als Zahl (Tage seit 1970), für Vergleiche über Mitternacht. */
function berlinDay(date: Date): number {
  return Math.round(Date.parse(dayFmt.format(date) + 'T00:00:00Z') / 86400000)
}

/** Abstand in Kalendertagen (Europe/Berlin) zwischen heute und `iso`; negativ = überfällig. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return berlinDay(new Date(iso)) - berlinDay(now)
}

export function dueCategory(iso: string, now: Date = new Date()): DueCategory {
  const d = daysUntil(iso, now)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d <= 7) return 'week'
  return 'later'
}

/** "heute 14:30", "morgen 07:45", "25.09. 09:00" */
export function formatPickup(iso: string, now: Date = new Date()): string {
  const d = daysUntil(iso, now)
  if (d === 0) return `heute ${formatTime(iso)}`
  if (d === 1) return `morgen ${formatTime(iso)}`
  return `${formatDate(iso).slice(0, 6)} ${formatTime(iso)}`
}

/** "17.09.–23.09." */
export function formatPeriod(startIso: string, endIso: string): string {
  return `${formatDate(startIso).slice(0, 6)}–${formatDate(endIso).slice(0, 6)}`
}

/** Tailwind-Klassen je Farbstufe (Tokens aus index.css). */
export const DUE_STYLE: Record<DueCategory, { dot: string; bar: string; tile: string; text: string }> = {
  today: { dot: 'bg-due-today', bar: 'bg-due-today', tile: 'border-due-today bg-due-today-bg', text: 'text-due-today-ink' },
  tomorrow: { dot: 'bg-due-tomorrow', bar: 'bg-due-tomorrow', tile: 'border-due-tomorrow bg-due-tomorrow-bg', text: 'text-due-tomorrow-ink' },
  week: { dot: 'bg-due-week', bar: 'bg-due-week', tile: 'border-due-week bg-due-week-bg', text: 'text-due-week-ink' },
  later: { dot: 'bg-due-later', bar: 'bg-due-later', tile: 'border-due-later bg-due-later-bg', text: 'text-due-later-ink' },
}
