export const TIME_ZONE = 'Europe/Berlin'

const dateFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type DateInput = Date | string | number

const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value))

/** TT.MM.JJJJ in Europe/Berlin */
export function formatDate(value: DateInput): string {
  return dateFmt.format(toDate(value))
}

/** HH:MM (24 h) in Europe/Berlin */
export function formatTime(value: DateInput): string {
  return timeFmt.format(toDate(value))
}

/** TT.MM.JJJJ HH:MM in Europe/Berlin */
export function formatDateTime(value: DateInput): string {
  return `${formatDate(value)} ${formatTime(value)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${units[unit]}`
}
