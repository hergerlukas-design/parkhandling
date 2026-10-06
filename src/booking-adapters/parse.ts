import type { ParkingType, PaymentStatus, ReturnMode } from '../types/domain'

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
    // Excel speichert Zeiten als Gleitkommazahl: 07:00 kommt als 06:59:59.999 an → auf Minuten runden
    dateValue = new Date(Math.round(dateValue.getTime() / 60000) * 60000)
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
  if (value instanceof Date) {
    const rounded = new Date(Math.round(value.getTime() / 60000) * 60000)
    return [rounded.getUTCHours(), rounded.getUTCMinutes()]
  }
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
  if (/^(indoor|halle|innen|hallenparken|parkhaus|garage|premium)/.test(v)) return 'indoor'
  if (/(plane|abdeck|cover|ueberdacht)/.test(v)) return 'outdoor_cover'
  if (/^(outdoor|aussen|freiflaeche|frei|open)/.test(v)) return 'outdoor'
  return null
}

export function parseReturnMode(value: CellValue): ReturnMode | null {
  const v = norm(value)
  if (!v) return null
  if (/(self|selbst|eigen)/.test(v)) return 'self'
  if (/(hol.*bring|bring.*hol|bringservice|holservice)/.test(v)) return 'pickup_delivery'
  if (/(vallet|valet|premium)/.test(v)) return 'vallet'
  if (/(shuttle|bus|transfer)/.test(v)) return 'shuttle'
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

// ---------------------------------------------------------------------------
// Vorlage „ParkHandling_Buchungsliste“
// ---------------------------------------------------------------------------

/** "1.234,50 €", "89", "89,9", "89.50" → Zahl; null bei leer/ungültig */
export function parseMoney(value: CellValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null
  let t = cleanText(value).replace(/€|eur|euro/gi, '').replace(/\s/g, '')
  if (!t || t === '-') return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function parsePaymentStatus(value: CellValue): PaymentStatus | null {
  const v = norm(value)
  if (!v) return null
  if (/(erstatt|refund|zurueck)/.test(v)) return 'refunded'
  if (/(teil|anzahl|partial)/.test(v)) return 'partial'
  if (/(bezahlt|paid|beglichen|erledigt)/.test(v) && !/unbezahlt/.test(v)) return 'paid'
  if (/(offen|unbezahlt|open|ausstehend)/.test(v)) return 'open'
  return null
}

const PLATE = /(?<![A-Za-zÄÖÜäöü0-9])([A-ZÄÖÜ]{1,3})(-|\s)([A-Z]{1,2})[\s-]?(\d{1,4})([EH])?(?![A-Za-z0-9])/g

export interface VehicleSplit {
  plate: string
  model: string | null
  /** true = Trennung unsicher; dann steht der ganze Text im Kennzeichen */
  uncertain: boolean
}

/**
 * "BMW 320d / M-AB 1234" → { plate: "M-AB 1234", model: "BMW 320d" }.
 * Sicher nur bei genau einem Treffer mit Bindestrich; sonst bleibt alles im Kennzeichen und wird markiert.
 */
export function splitVehicle(value: CellValue): VehicleSplit {
  const text = cleanText(value)
  const matches = [...text.toUpperCase().matchAll(PLATE)]
  const withHyphen = matches.filter((m) => m[2] === '-')
  // Ohne Bindestrich (z. B. "VW ID 4") oder mehrdeutig: nicht raten, alles im Kennzeichen lassen
  const m = withHyphen.length === 1 ? withHyphen[0] : null
  if (!m) return { plate: text.toUpperCase(), model: null, uncertain: text !== '' }
  const plate = `${m[1]}-${m[3]} ${m[4]}${m[5] ?? ''}`
  const model = (text.slice(0, m.index) + ' ' + text.slice(m.index! + m[0].length))
    .replace(/[,;/|()]+/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { plate, model: model || null, uncertain: false }
}

/** Spalte „Aufbereitung / Pflege“ → Leistungscodes */
export function parseCleaning(value: CellValue): string[] {
  const v = norm(value)
  if (!v || /^(nein|keine?|no|0)$/.test(v)) return []
  const codes = new Set<string>()
  if (/(komplett|voll|innen ?(und|u)? ?aussen|aussen ?(und|u)? ?innen|^ja$|^x$|^1$)/.test(v)) {
    codes.add('AUF_INNEN')
    codes.add('AUF_AUSSEN')
  }
  if (/innen/.test(v)) codes.add('AUF_INNEN')
  if (/aussen|waesche|wasch/.test(v)) codes.add('AUF_AUSSEN')
  if (/polit/.test(v)) codes.add('POLITUR')
  if (/(laden|lade|e auto|strom)/.test(v)) codes.add('LADEN')
  if (/tank/.test(v)) codes.add('TANKEN')
  if (/(service|oel|reifen|inspektion)/.test(v)) codes.add('SERVICE')
  if (codes.size === 0) codes.add('ZUSATZ')
  return [...codes]
}

export type ServiceKind = 'park' | 'premium' | 'care' | 'pickup_delivery' | 'transfer' | 'extra'

/** Spalte „Leistung“ (Excel) → Buchungsart */
export function parseServiceKind(value: CellValue): ServiceKind | null {
  const v = norm(value)
  if (!v) return null
  if (/premium/.test(v)) return 'premium'
  if (/(hol.*bring|bring.*hol|bringservice|holservice)/.test(v)) return 'pickup_delivery'
  if (/(pflege|aufbereitung)/.test(v)) return 'care'
  if (/transfer/.test(v)) return 'transfer'
  if (/zusatz/.test(v)) return 'extra'
  if (/park/.test(v)) return 'park'
  return null
}

/** Spalte „Transfer Flughafen“ → Rückgabeart (null = keine Angabe) */
export function parseTransfer(value: CellValue): ReturnMode | null {
  const v = norm(value)
  if (!v || v === '-') return null
  if (/(vallet|valet|premium|terminal)/.test(v)) return 'vallet'
  if (/^(nein|no|selbst|keiner?|0)$/.test(v)) return 'self'
  return 'shuttle'
}

export function looksLikeCompany(name: string): boolean {
  return /\b(GmbH|mbH|AG|KG|OHG|GbR|UG|e\.\s?K\.|SE|Ltd\.?|Inc\.?|Co\.)(\b|$)/i.test(name)
}
