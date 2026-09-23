import type { BookingAdapter, BookingInput, NormalizeResult } from './types'
import {
  cleanPlate,
  cleanText,
  parseBoolean,
  parseDateTime,
  parseParkingType,
  parsePersons,
  parseReturnMode,
  parseServiceCodes,
  type CellValue,
} from './parse'

/** Zielfelder, auf die Tabellenspalten abgebildet werden können. */
export const TARGET_FIELDS = {
  external_ref: 'Buchungsnummer',
  customer_name: 'Kundenname',
  customer_email: 'E-Mail',
  customer_phone: 'Telefon',
  plate: 'Kennzeichen',
  vehicle_model: 'Fahrzeug',
  persons: 'Personen',
  start_at: 'Ankunft (Datum + Zeit)',
  start_date: 'Ankunft Datum',
  start_time: 'Ankunft Uhrzeit',
  end_at: 'Abholung (Datum + Zeit)',
  end_date: 'Abholung Datum',
  end_time: 'Abholung Uhrzeit',
  parking_type: 'Parkart',
  return_mode: 'Rückgabe (Shuttle/Vallet)',
  services: 'Leistungen',
  notes: 'Bemerkung',
  cancelled: 'Storniert',
} as const

export type TargetField = keyof typeof TARGET_FIELDS
/** Zielfeld → Spaltenindex */
export type ColumnMapping = Partial<Record<TargetField, number>>

export interface Table {
  headers: string[]
  rows: CellValue[][]
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

/** RFC-4180-CSV mit automatischer Trennzeichen-Erkennung (; , Tab) und BOM-Behandlung. */
export function parseCsv(input: string): Table {
  const text = input.replace(/^﻿/, '')
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  const [headers = [], ...data] = nonEmpty
  return { headers: headers.map((h) => h.trim()), rows: data }
}

/** CSV oder Excel (.xlsx) einlesen. Excel-Unterstützung wird erst bei Bedarf nachgeladen. */
export async function readTable(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml')) {
    const { readSheet } = await import('read-excel-file/browser')
    const data = (await readSheet(file)) as CellValue[][]
    const nonEmpty = data.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
    const [headers = [], ...rows] = nonEmpty
    return { headers: headers.map((h) => String(h ?? '').trim()), rows }
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error('Altes Excel-Format (.xls) wird nicht unterstützt – bitte als .xlsx oder CSV speichern.')
  }
  const buffer = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buffer)
  // Excel speichert CSV unter Windows oft als Windows-1252
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer)
  return parseCsv(text)
}

// ---------------------------------------------------------------------------
// Spaltenzuordnung
// ---------------------------------------------------------------------------

const HEADER_HINTS: [TargetField, RegExp][] = [
  ['external_ref', /^(buchungs?(nr|nummer|id|code)|booking ?(id|ref|no|number)|auftrags?nr|reservierungs?nr|referenz|ref)$/],
  ['customer_email', /(e ?mail|mail)/],
  ['customer_phone', /(telefon|tel|handy|mobil|phone)/],
  ['customer_name', /^(kunde|kundenname|name|customer|customer ?name|nachname|vor ?und ?nachname)$/],
  ['plate', /(kennzeichen|kfz|plate|license)/],
  ['vehicle_model', /(fahrzeug|modell|marke|model|vehicle|auto)/],
  ['persons', /(personen|pers|pax|anzahl ?person|passagiere)/],
  ['start_time', /^(ankunft|anreise|start|einfahrt|hinflug|abgabe|check ?in)s? ?(zeit|uhrzeit|time)$/],
  ['start_date', /^(ankunft|anreise|start|einfahrt|hinflug|abgabe|check ?in)s? ?(datum|date|tag)$/],
  ['start_at', /^(ankunft|anreise|start|von|einfahrt|hinflug|abgabe|check ?in|beginn|arrival)/],
  ['end_time', /^(abholung|abreise|ende|rueckkehr|rueckflug|ausfahrt|check ?out)s? ?(zeit|uhrzeit|time)$/],
  ['end_date', /^(abholung|abreise|ende|rueckkehr|rueckflug|ausfahrt|check ?out)s? ?(datum|date|tag)$/],
  ['end_at', /^(abholung|abreise|ende|bis|rueckkehr|rueckflug|ausfahrt|check ?out|departure|return)/],
  ['parking_type', /(parkart|parkplatzart|stellplatz ?art|parkplatz|produkt|tarif|parking)/],
  ['return_mode', /(rueckgabe|transfer|shuttle|vallet|valet|service ?art)/],
  ['services', /(leistung|zusatz|extras|services|optionen)/],
  ['notes', /(bemerkung|notiz|kommentar|hinweis|notes?|anmerkung)/],
  ['cancelled', /(storn|cancel)/],
]

const normHeader = (h: string) =>
  h
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Schlägt eine Zuordnung anhand der Spaltenüberschriften vor. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const used = new Set<number>()
  for (const [field, pattern] of HEADER_HINTS) {
    if (mapping[field] !== undefined) continue
    const index = headers.findIndex((h, i) => !used.has(i) && pattern.test(normHeader(h)))
    if (index >= 0) {
      mapping[field] = index
      used.add(index)
    }
  }
  return mapping
}

export function mappingProblems(mapping: ColumnMapping): string[] {
  const problems: string[] = []
  const has = (f: TargetField) => mapping[f] !== undefined
  if (!has('customer_name')) problems.push('Kundenname fehlt')
  if (!has('plate')) problems.push('Kennzeichen fehlt')
  if (!has('start_at') && !has('start_date')) problems.push('Ankunft fehlt')
  if (!has('end_at') && !has('end_date')) problems.push('Abholung fehlt')
  if (!has('parking_type')) problems.push('Parkart fehlt (oder Standard wählen)')
  if (!has('external_ref')) problems.push('Ohne Buchungsnummer sind Umbuchungen nicht erkennbar – jeder Import legt neu an')
  return problems
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface TabularAdapterOptions {
  source: string
  mapping: ColumnMapping
  /** Parkart, falls die Datei keine Spalte dafür hat */
  defaultParkingType?: BookingInput['parking_type'] | null
}

export function createTabularAdapter(options: TabularAdapterOptions): BookingAdapter<CellValue[]> {
  const { mapping } = options
  const get = (row: CellValue[], field: TargetField): CellValue =>
    mapping[field] === undefined ? undefined : row[mapping[field]!]
  const mapped = (field: TargetField) => mapping[field] !== undefined

  return {
    source: options.source,
    normalize(row): NormalizeResult {
      const errors: string[] = []
      const warnings: string[] = []

      const customer_name = cleanText(get(row, 'customer_name'))
      const plate = cleanPlate(get(row, 'plate'))
      if (!customer_name) errors.push('Kundenname fehlt')
      if (!plate) errors.push('Kennzeichen fehlt')

      const start_at = mapped('start_at')
        ? parseDateTime(get(row, 'start_at'), get(row, 'start_time'))
        : parseDateTime(get(row, 'start_date'), get(row, 'start_time'))
      const end_at = mapped('end_at')
        ? parseDateTime(get(row, 'end_at'), get(row, 'end_time'))
        : parseDateTime(get(row, 'end_date'), get(row, 'end_time'))
      if (!start_at) errors.push('Ankunft ungültig')
      if (!end_at) errors.push('Abholung ungültig')
      if (start_at && end_at && end_at <= start_at) errors.push('Abholung liegt nicht nach der Ankunft')

      const parkingRaw = get(row, 'parking_type')
      const parking_type = parseParkingType(parkingRaw) ?? options.defaultParkingType ?? null
      if (!parking_type) errors.push(`Parkart unbekannt: „${cleanText(parkingRaw)}“`)

      const booking: BookingInput = {
        customer_name,
        plate,
        start_at: start_at ?? '',
        end_at: end_at ?? '',
        parking_type: parking_type ?? 'outdoor',
      }
      if (mapped('external_ref')) booking.external_ref = cleanText(get(row, 'external_ref')) || null
      if (mapped('customer_email')) booking.customer_email = cleanText(get(row, 'customer_email')) || null
      if (mapped('customer_phone')) booking.customer_phone = cleanText(get(row, 'customer_phone')) || null
      if (mapped('vehicle_model')) booking.vehicle_model = cleanText(get(row, 'vehicle_model')) || null
      if (mapped('notes')) booking.notes = cleanText(get(row, 'notes')) || null
      if (mapped('services')) booking.services = parseServiceCodes(get(row, 'services'))
      if (mapped('cancelled')) booking.cancelled = parseBoolean(get(row, 'cancelled'))
      if (mapped('persons')) {
        const raw = get(row, 'persons')
        const persons = parsePersons(raw)
        if (persons === null && cleanText(raw)) warnings.push(`Personen „${cleanText(raw)}“ ignoriert`)
        booking.persons = persons
      }
      if (mapped('return_mode')) {
        const raw = get(row, 'return_mode')
        const mode = parseReturnMode(raw)
        if (!mode && cleanText(raw)) warnings.push(`Rückgabe „${cleanText(raw)}“ unbekannt – Shuttle angenommen`)
        booking.return_mode = mode
      }

      return errors.length ? { ok: false, errors } : { ok: true, booking, warnings }
    },
  }
}
