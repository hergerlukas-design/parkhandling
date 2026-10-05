import type { BookingAdapter, BookingInput, NormalizeResult, ServiceInput } from './types'
import {
  cleanPlate,
  cleanText,
  looksLikeCompany,
  parseBoolean,
  parseCleaning,
  parseDateTime,
  parseMoney,
  parseParkingType,
  parsePaymentStatus,
  parsePersons,
  parseReturnMode,
  parseServiceCodes,
  parseServiceKind,
  parseTransfer,
  splitVehicle,
  type CellValue,
} from './parse'

/**
 * Zielfelder für die Spaltenzuordnung. Die ersten Einträge entsprechen der Vorlage
 * „ParkHandling_Buchungsliste“ (Sheet „Buchungseingänge“), die übrigen erlauben andere Exporte.
 * „Anzahl Tage“ wird bewusst nicht importiert, sondern aus Anreise/Abholung berechnet.
 */
export const TARGET_FIELDS = {
  external_ref: 'Buchungs-Nr.',
  received_at: 'Eingang am',
  status: 'Status (storniert?)',
  customer: 'Kunde / Firma',
  customer_phone: 'Telefon',
  customer_email: 'E-Mail',
  vehicle: 'Fahrzeug / Kennzeichen',
  service_kind: 'Leistung',
  start_at: 'Anreise / Fahrzeugabgabe',
  end_at: 'Abholung / Rückgabe',
  parking: 'Parkplatz',
  cleaning: 'Aufbereitung / Pflege',
  pickup_delivery: 'Hol- & Bringservice',
  transfer: 'Transfer Flughafen',
  price: 'Preis (€)',
  payment_status: 'Zahlungsstatus',
  notes: 'Besondere Wünsche / Notizen',
  // weitere Formate
  plate: 'Kennzeichen (eigene Spalte)',
  vehicle_model: 'Fahrzeugmodell (eigene Spalte)',
  start_date: 'Anreise Datum (getrennt)',
  start_time: 'Anreise Uhrzeit (getrennt)',
  end_date: 'Abholung Datum (getrennt)',
  end_time: 'Abholung Uhrzeit (getrennt)',
  persons: 'Personen',
  services: 'Leistungscodes (GRUND, LADEN, …)',
} as const

export type TargetField = keyof typeof TARGET_FIELDS
/** Zielfeld → Spaltenindex */
export type ColumnMapping = Partial<Record<TargetField, number>>

export interface Table {
  headers: string[]
  rows: CellValue[][]
  /** Name des gelesenen Excel-Blatts */
  sheet?: string
}

export const TEMPLATE_SHEET = 'Buchungseingänge'

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

/** RFC-4180-CSV in Zeilen zerlegen (Trennzeichen ; , Tab automatisch, BOM wird entfernt). */
export function parseCsvRows(input: string): string[][] {
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
  return rows
}

const isEmptyRow = (r: CellValue[]) => r.every((c) => c === null || c === undefined || String(c).trim() === '')

/**
 * Kopfzeile finden: Die Vorlage kann Titelzeilen über der Tabelle haben. Gewählt wird die Zeile
 * (unter den ersten 15) mit den meisten erkannten Spaltenüberschriften.
 */
export function toTable(raw: CellValue[][], sheet?: string): Table {
  const rows = raw.filter((r) => !isEmptyRow(r))
  let headerIndex = 0
  let best = -1
  rows.slice(0, 15).forEach((r, i) => {
    const score = Object.keys(guessMapping(r.map((c) => String(c ?? '')))).length
    if (score > best) {
      best = score
      headerIndex = i
    }
  })
  const headers = (rows[headerIndex] ?? []).map((h) => String(h ?? '').trim())
  return { headers, rows: rows.slice(headerIndex + 1), sheet }
}

export function parseCsv(input: string): Table {
  return toTable(parseCsvRows(input))
}

/** CSV oder Excel (.xlsx). Excel-Unterstützung wird erst bei Bedarf nachgeladen. */
export async function readTable(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    const sheet =
      sheets.find((s) => s.sheet.trim().toLowerCase() === TEMPLATE_SHEET.toLowerCase()) ??
      sheets.find((s) => s.data.some((r) => !isEmptyRow(r as CellValue[]))) ??
      sheets[0]
    if (!sheet) throw new Error('Die Excel-Datei enthält kein Tabellenblatt.')
    return toTable(sheet.data as CellValue[][], sheet.sheet)
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

// Reihenfolge ist wichtig: spezifischere Muster zuerst
const HEADER_HINTS: [TargetField, RegExp][] = [
  ['external_ref', /^(buchungs ?(nr|nummer|id|code)|booking ?(id|ref|no|number)|auftrags ?nr|reservierungs ?nr|referenz)$/],
  ['received_at', /^(eingang|eingegangen|gebucht am|buchungsdatum|erstellt)/],
  ['payment_status', /zahlung|bezahlt|payment/],
  ['status', /^(status|buchungsstatus|storniert|storno)$/],
  ['vehicle', /(fahrzeug ?kennzeichen|kennzeichen ?fahrzeug)/],
  ['plate', /(kennzeichen|kfz|plate|license)/],
  ['vehicle_model', /^(fahrzeug|modell|marke|model|vehicle|auto)/],
  ['customer_email', /(e ?mail|mail)/],
  ['customer_phone', /(telefon|tel|handy|mobil|phone)/],
  ['customer', /^(kunde|kunde ?firma|kundenname|name|customer|firma)/],
  ['pickup_delivery', /(hol.*bring|bring.*hol)/],
  ['transfer', /^transfer/],
  ['cleaning', /^(aufbereitung|pflege|reinigung)/],
  ['services', /^(leistungscodes?|services|extras)$/],
  ['service_kind', /^(leistung|leistungsart|produkt|tarif)/],
  ['start_time', /^(anreise|ankunft|abgabe|start|check ?in)s? ?(zeit|uhrzeit|time)$/],
  ['start_date', /^(anreise|ankunft|abgabe|start|check ?in)s? ?(datum|date|tag)$/],
  ['start_at', /^(anreise|ankunft|abgabe|start|von|einfahrt|hinflug|check ?in|beginn|arrival)/],
  ['end_time', /^(abholung|rueckgabe|abreise|ende|check ?out)s? ?(zeit|uhrzeit|time)$/],
  ['end_date', /^(abholung|rueckgabe|abreise|ende|check ?out)s? ?(datum|date|tag)$/],
  ['end_at', /^(abholung|rueckgabe|abreise|ende|bis|rueckkehr|rueckflug|ausfahrt|check ?out|departure|return)/],
  ['parking', /^(parkplatz|parkart|stellplatz|parking)/],
  ['price', /^(preis|betrag|summe|gesamt|price)/],
  ['persons', /^(personen|pers|pax|anzahl ?person|passagiere)/],
  ['notes', /(notiz|bemerkung|wuensche|kommentar|hinweis|notes?|anmerkung)/],
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
    const index = headers.findIndex((h, i) => !used.has(i) && h.trim() !== '' && pattern.test(normHeader(h)))
    if (index >= 0) {
      mapping[field] = index
      used.add(index)
    }
  }
  return mapping
}

export function mappingProblems(mapping: ColumnMapping, hasDefaultParking = false): string[] {
  const problems: string[] = []
  const has = (f: TargetField) => mapping[f] !== undefined
  if (!has('customer')) problems.push('Kunde / Firma fehlt')
  if (!has('vehicle') && !has('plate')) problems.push('Fahrzeug / Kennzeichen fehlt')
  if (!has('start_at') && !has('start_date')) problems.push('Anreise fehlt')
  if (!has('end_at') && !has('end_date')) problems.push('Abholung fehlt')
  if (!has('parking') && !has('service_kind') && !hasDefaultParking) problems.push('Parkplatz fehlt (oder Standard wählen)')
  if (!has('external_ref')) problems.push('Ohne Buchungs-Nr. sind Umbuchungen nicht erkennbar – jeder Import legt neu an')
  return problems
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface TabularAdapterOptions {
  source: string
  mapping: ColumnMapping
  /** Parkart, falls Datei weder „Parkplatz“ noch „Leistung“ eindeutig liefert */
  defaultParkingType?: BookingInput['parking_type'] | null
}

export const PLATE_CHECK_NOTE = '⚠ Kennzeichen prüfen'

export function createTabularAdapter(options: TabularAdapterOptions): BookingAdapter<CellValue[]> {
  const { mapping } = options
  const mapped = (field: TargetField) => mapping[field] !== undefined
  const get = (row: CellValue[], field: TargetField): CellValue =>
    mapping[field] === undefined ? undefined : row[mapping[field]!]

  return {
    source: options.source,
    normalize(row): NormalizeResult {
      const errors: string[] = []
      const warnings: string[] = []

      // Kunde / Firma
      const customer_name = cleanText(get(row, 'customer'))
      if (!customer_name) errors.push('Kunde / Firma fehlt')

      // Fahrzeug / Kennzeichen
      let plate = mapped('plate') ? cleanPlate(get(row, 'plate')) : ''
      let vehicle_model = mapped('vehicle_model') ? cleanText(get(row, 'vehicle_model')) || null : null
      let plateUncertain = false
      if (!plate && mapped('vehicle')) {
        const split = splitVehicle(get(row, 'vehicle'))
        plate = split.plate
        vehicle_model = vehicle_model ?? split.model
        plateUncertain = split.uncertain
        if (split.uncertain && plate) warnings.push('Kennzeichen/Fahrzeug nicht sicher trennbar – markiert')
      }
      if (!plate) errors.push('Kennzeichen fehlt')

      // Zeitraum
      const start_at = mapped('start_at')
        ? parseDateTime(get(row, 'start_at'), get(row, 'start_time'))
        : parseDateTime(get(row, 'start_date'), get(row, 'start_time'))
      const end_at = mapped('end_at')
        ? parseDateTime(get(row, 'end_at'), get(row, 'end_time'))
        : parseDateTime(get(row, 'end_date'), get(row, 'end_time'))
      if (!start_at) errors.push('Anreise ungültig')
      if (!end_at) errors.push('Abholung ungültig')
      if (start_at && end_at && end_at <= start_at) errors.push('Abholung liegt nicht nach der Anreise')

      // Leistung (Buchungsart) und Parkplatz
      const kind = parseServiceKind(get(row, 'service_kind'))
      const parkingRaw = get(row, 'parking')
      const parking_type =
        parseParkingType(parkingRaw) ??
        (kind === 'premium' ? 'indoor' : null) ??
        options.defaultParkingType ??
        (kind ? 'outdoor' : null)
      if (!parking_type) errors.push(`Parkplatz unbekannt: „${cleanText(parkingRaw)}“`)
      else if (!parseParkingType(parkingRaw) && cleanText(parkingRaw))
        warnings.push(`Parkplatz „${cleanText(parkingRaw)}“ unbekannt – ${parking_type === 'indoor' ? 'Halle' : 'Außen'} angenommen`)

      // Rückgabe: Hol- & Bringservice > Transfer-Spalte > Leistung
      let return_mode: BookingInput['return_mode'] = null
      if (mapped('pickup_delivery') && parseBoolean(get(row, 'pickup_delivery'))) return_mode = 'pickup_delivery'
      else if (mapped('transfer')) return_mode = parseTransfer(get(row, 'transfer'))
      if (!return_mode && kind === 'pickup_delivery') return_mode = 'pickup_delivery'

      // Leistungen
      let services: (string | ServiceInput)[] | undefined
      if (mapped('cleaning') || mapped('services') || kind === 'care' || kind === 'extra') {
        const codes = new Set<string>([
          ...(mapped('cleaning') ? parseCleaning(get(row, 'cleaning')) : []),
          ...(mapped('services') ? parseServiceCodes(get(row, 'services')) : []),
        ])
        if (kind === 'care' && codes.size === 0) {
          codes.add('AUF_INNEN')
          codes.add('AUF_AUSSEN')
        }
        services = [...codes].map((code) =>
          code === 'ZUSATZ'
            ? { code, description: cleanText(get(row, 'cleaning')) || cleanText(get(row, 'service_kind')) || null }
            : code,
        )
        if (kind === 'extra' && !codes.has('ZUSATZ')) {
          services.push({ code: 'ZUSATZ', description: cleanText(get(row, 'notes')) || 'Zusatzleistung' })
        }
      }

      const notesText = cleanText(get(row, 'notes'))
      const notes = plateUncertain ? [`${PLATE_CHECK_NOTE}: „${cleanText(get(row, 'vehicle'))}“`, notesText].filter(Boolean).join(' · ') : notesText

      const booking: BookingInput = {
        customer_name,
        plate,
        start_at: start_at ?? '',
        end_at: end_at ?? '',
        parking_type: parking_type ?? 'outdoor',
      }
      if (customer_name && looksLikeCompany(customer_name)) booking.company = customer_name
      if (mapped('external_ref')) booking.external_ref = cleanText(get(row, 'external_ref')) || null
      if (mapped('received_at')) {
        const received = parseDateTime(get(row, 'received_at'))
        if (!received && cleanText(get(row, 'received_at'))) warnings.push('„Eingang am“ unlesbar – ignoriert')
        if (received) booking.received_at = received
      }
      if (mapped('customer_email')) booking.customer_email = cleanText(get(row, 'customer_email')) || null
      if (mapped('customer_phone')) booking.customer_phone = cleanText(get(row, 'customer_phone')) || null
      if (vehicle_model !== null || mapped('vehicle') || mapped('vehicle_model')) booking.vehicle_model = vehicle_model
      if (mapped('notes') || plateUncertain) booking.notes = notes || null
      if (return_mode) booking.return_mode = return_mode
      if (services) booking.services = services
      if (mapped('status')) booking.cancelled = /storn|cancel/i.test(cleanText(get(row, 'status')))
      if (mapped('price')) {
        const raw = get(row, 'price')
        const price = parseMoney(raw)
        if (price === null && cleanText(raw) && cleanText(raw) !== '-') warnings.push(`Preis „${cleanText(raw)}“ unlesbar – ignoriert`)
        booking.price_total = price
      }
      if (mapped('payment_status')) {
        const raw = get(row, 'payment_status')
        const status = parsePaymentStatus(raw)
        if (!status && cleanText(raw)) warnings.push(`Zahlungsstatus „${cleanText(raw)}“ unbekannt – ignoriert`)
        if (status) booking.payment_status = status
      }
      if (mapped('persons')) {
        const raw = get(row, 'persons')
        const persons = parsePersons(raw)
        if (persons === null && cleanText(raw)) warnings.push(`Personen „${cleanText(raw)}“ ignoriert`)
        if (persons !== null) booking.persons = persons
      }
      if (!return_mode && mapped('service_kind') && parseReturnMode(get(row, 'service_kind'))) {
        booking.return_mode = parseReturnMode(get(row, 'service_kind'))
      }

      return errors.length ? { ok: false, errors } : { ok: true, booking, warnings }
    },
  }
}

/** Anzahl Tage wie in der Vorlage (angebrochene Tage zählen voll), nur zur Anzeige. */
export function countDays(startIso: string, endIso: string): number {
  const ms = Date.parse(endIso) - Date.parse(startIso)
  return Math.max(1, Math.ceil(ms / 86400000))
}
