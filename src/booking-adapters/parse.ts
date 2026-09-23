import type { ParkingType, ReturnMode } from '../types/domain'

const TZ = 'Europe/Berlin'

const offsetFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Abstand Berlin–UTC in Minuten zum Zeitpunkt `utcMs`. */
function berlinOffsetMinutes(utcMs: number): number {
  const parts = Object.fromEntries(offsetFmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - utcMs) / 60000)
}

/** Wandelt eine Berliner Ortszeit (Wanduhr) in einen ISO-Zeitstempel (UTC) um. */
export function berlinToIso(year: number, month: number, day: number, hour = 0, minute = 0): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let utc = wall - berlinOffsetMinutes(wall) * 60000
  utc = wall - berlinOffsetMinutes(utc) * 60000
  const check = new Date(wall)
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null
  return new Date(utc).toISOString()
}

export type CellValue = string | number | boolean | Date | null | undefined

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

/**
 * Datum (+ optional Uhrzeit) → ISO. Akzeptiert TT.MM.JJJJ [HH:MM], JJJJ-MM-TT[THH:MM],
 * ISO mit Zeitzone, Excel-Datumswerte (Date, Wanduhrzeit in UTC-Feldern) und Excel-Seriennummern.
 */
export function parseDateTime(dateValue: CellValue, timeValue?: CellValue): string | null {
  let hour = 0
  let minute = 0
  const time = parseTime(timeValue)
  if (timeValue !== undefined && timeValue !== null && cellToString(timeValue) !== '' && !time) return null
  if (time) [hour, minute] = time

  if (dateValue instanceof Date) {
    if (Number.isNaN(dateValue.getTime())) return null
    const h = time ? hour : dateValue.getUTCHours()
    const m = time ? minute : dateValue.getUTCMinutes()
    return berlinToIso(dateValue.getUTCFullYear(), dateValue.getUTCMonth() + 1, dateValue.getUTCDate(), h, m)
  }
  if (typeof dateValue === 'number') {
    // Excel-Seriennummer (Tage seit 30.12.1899), Nachkommastellen = Uhrzeit
    const ms = Math.round((dateValue - 25569) * 86400000)
    return parseDateTime(new Date(ms), timeValue)
  }

  const text = cellToString(dateValue)
  if (!text) return null

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) && text.includes('T')) {
    const d = new Date(text)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:[ ,T]+(\d{1,2})[:.](\d{2}))?(?::\d{2})?(?:\s*Uhr)?$/.exec(text)
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    if (m[4] && !time) [hour, minute] = [Number(m[4]), Number(m[5])]
    return berlinToIso(year, Number(m[2]), Number(m[1]), hour, minute)
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(text)
  if (m) {
    if (m[4] && !time) [hour, minute] = [Number(m[4]), Number(m[5])]
    return berlinToIso(Number(m[1]), Number(m[2]), Number(m[3]), hour, minute)
  }
  return null
}

/** HH:MM, H.MM, "6 Uhr", Excel-Zeitanteil (0–1) oder Date → [Stunde, Minute] */
export function parseTime(value: CellValue): [number, number] | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return [value.getUTCHours(), value.getUTCMinutes()]
  if (typeof value === 'number') {
    if (value < 0 || value >= 1) return null
    const total = Math.round(value * 24 * 60)
    return [Math.floor(total / 60) % 24, total % 60]
  }
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(?:Uhr)?$/i.exec(String(value).trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  return h <= 23 && min <= 59 ? [h, min] : null
}

const norm = (v: CellValue) =>
  cellToString(v)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export function parseParkingType(value: CellValue): ParkingType | null {
  const v = norm(value)
  if (!v) return null
  if (/^(indoor|halle|innen|hallenparken|parkhaus|garage)/.test(v)) return 'indoor'
  if (/(plane|abdeck|cover|ueberdacht)/.test(v)) return 'outdoor_cover'
  if (/^(outdoor|aussen|freiflaeche|frei|open)/.test(v)) return 'outdoor'
  return null
}

export function parseReturnMode(value: CellValue): ReturnMode | null {
  const v = norm(value)
  if (!v) return null
  if (/(vallet|valet|premium|bring)/.test(v)) return 'vallet'
  if (/(shuttle|bus|transfer)/.test(v)) return 'shuttle'
  if (/(self|selbst|abholer|eigen)/.test(v)) return 'self'
  return null
}

export function parseBoolean(value: CellValue): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return /^(1|ja|j|yes|y|true|wahr|x|storniert|storno|cancelled|canceled)$/.test(norm(value))
}

/** "INNEN, Laden; tanken" → ["INNEN", "LADEN", "TANKEN"] */
export function parseServiceCodes(value: CellValue): string[] {
  return [
    ...new Set(
      cellToString(value)
        .split(/[,;|/+\n]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
}

export function parsePersons(value: CellValue): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 50 ? value : null
  const m = /^\d{1,2}$/.exec(cellToString(value))
  return m ? Number(m[0]) : null
}

export function cleanText(value: CellValue): string {
  return cellToString(value).replace(/\s+/g, ' ')
}

/** Kennzeichen vereinheitlichen: Großbuchstaben, einfache Leerzeichen */
export function cleanPlate(value: CellValue): string {
  return cleanText(value).toUpperCase()
}
