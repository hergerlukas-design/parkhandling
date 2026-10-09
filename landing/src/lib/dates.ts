// Datumshilfen: Speicherung als YYYY-MM-DD, Anzeige als TT.MM.JJJJ, „heute“ in Europe/Berlin

export const TIME_ZONE = 'Europe/Berlin'

/** Heutiges Datum in Europe/Berlin als YYYY-MM-DD */
export function todayInBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** YYYY-MM-DD → TT.MM.JJJJ */
export function formatDateDE(iso: string): string {
  if (!isIsoDate(iso)) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// Feste Kürzel statt Intl: ICU-Versionen liefern „Mo“ oder „Mo.“
const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']

/** YYYY-MM-DD → „Mo., 12.10.2026“ */
export function formatDateLongDE(iso: string): string {
  if (!isIsoDate(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${formatDateDE(iso)}`
}

/** Anzahl Kalendertage zwischen zwei Daten */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  })
  return Math.round((b - a) / 86_400_000)
}
