/**
 * Adapter für Parkos-Bestätigungsmails (`source = 'parkos'`).
 *
 * Gemeinsam für den manuellen Import (Mail einfügen / .eml hochladen) und den späteren
 * automatischen IMAP-Abruf: Eingabe ist die Rohmail, Ausgabe ein normalisiertes
 * Ergebnis plus der Datensatz für `import_booking_mail`. Nur reines TypeScript ohne
 * DOM, damit der Code auch in einer Edge Function (Deno) läuft.
 *
 * Gelesen wird über Label → Wert, nicht über Positionen. Belegt ist bisher nur die Mail
 * „Eine neue Reservierung über Parkos“ (Testbuchung #494PHBR, 22.10.2026). Umbuchungen
 * und Stornos werden erkannt, aber nur zur Prüfung abgelegt.
 */
import type { ParkingType, ReturnMode } from '../types/domain'
import { decodeMail, senderAddress, type DecodedMail } from './mail/decode'
import { normalizeFlightNo } from './manual'
import { berlinToIso, parseMoney } from './parse'
import { normalizePlate } from './plate'
import type { BookingInput } from './types'

export const PARKOS_SOURCE = 'parkos'

export type MailType = 'new' | 'change' | 'cancel' | 'unknown'

/** Hinweise, die in `bookings.import_flags` bzw. `booking_imports.flags` landen */
export type ImportFlag =
  | 'plate_unverified'
  | 'phone_missing'
  | 'unknown_product'
  | 'parking_type_manual'
  | 'sender_unverified'

export const IMPORT_FLAG_LABEL: Record<ImportFlag, string> = {
  plate_unverified: 'Kennzeichen prüfen',
  phone_missing: 'Telefon fehlt',
  unknown_product: 'Parkform unbekannt',
  parking_type_manual: 'Parkart von Hand gewählt',
  sender_unverified: 'Absender nicht Parkos',
}

export const MAIL_TYPE_LABEL: Record<MailType, string> = {
  new: 'Neue Reservierung',
  change: 'Umbuchung',
  cancel: 'Stornierung',
  unknown: 'Unbekannt',
}

/** Eintrag aus `settings.parkos_product_map` */
export interface ParkosProduct {
  parkos_label: string
  parking_type: ParkingType
  return_mode: ReturnMode
}

export interface ParkosOptions {
  /** `settings.parkos_product_map` */
  productMap: ParkosProduct[]
  /** `settings.return_buffer_minutes` (Landung → Abholung am Platz) */
  bufferMinutes: number
  /** Parkart von Hand, wenn die Parkform unbekannt ist (nur im Import-Dialog) */
  parkingTypeOverride?: ParkingType | null
}

/** Rohwerte so, wie sie in der Mail stehen (für die Vorschau) */
export interface ParkosFields {
  externalRef: string | null
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  language: string | null
  vehicleModel: string | null
  plateRaw: string | null
  persons: number | null
  parkform: string | null
  transfer: string | null
  flightOut: string | null
  flightReturn: string | null
  arrivalDate: string | null
  arrivalTime: string | null
  returnDate: string | null
  returnTime: string | null
  totalCustomer: number | null
  payout: number | null
  paidInAdvance: boolean
}

export interface ParkosParseResult {
  mailType: MailType
  subject: string | null
  sender: string | null
  receivedAt: string | null
  externalRef: string | null
  fields: ParkosFields
  /** null, wenn Pflichtangaben fehlen */
  booking: BookingInput | null
  portalPayout: number | null
  flags: ImportFlag[]
  /** Fehlende Pflichtangaben (Buchung wird dann nicht angelegt) */
  errors: string[]
  /** Klartext der Mail (wird in booking_imports.raw_text gespeichert) */
  text: string
}

const MAX_RAW_TEXT = 200_000

// ---------------------------------------------------------------------------
// Label → Wert
// ---------------------------------------------------------------------------

/** Liest den Wert hinter einem Label: Rest der Zeile/Zelle oder – falls leer – die nächste Zeile. */
function field(text: string, label: RegExp): string | null {
  const re = new RegExp(`(?:^|[\\n\\t])\\s*(?:${label.source})\\s*:?[ \\t]*([^\\n]*)`, 'i')
  const m = re.exec(text)
  if (!m) return null
  const following = text
    .slice(m.index + m[0].length)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const isLabelLine = (line: string) => /:\s*$/.test(line.split('\t')[0])
  let value = m[1].trim()
  let rest = following
  if (!value) {
    // Wert steht in der nächsten Zeile (eingefügter Text) – außer dort beginnt schon das nächste Label
    if (!following.length || isLabelLine(following[0])) return null
    value = following[0]
    rest = following.slice(1)
  }
  // Wert in einer Tabellenzelle: nur bis zur nächsten Zelle
  value = value.split('\t')[0].trim()
  // Umbrochene Klammer „Shuttle-Transfer (nicht“ + „überdacht)“ wieder zusammenfügen
  const cont = rest[0]
  if (value.includes('(') && !value.includes(')') && cont && cont.includes(')') && !cont.includes(':')) {
    value = `${value} ${cont.split('\t')[0]}`
  }
  return value || null
}

/** Betrag hinter einem Label (auch wenn dazwischen ein Hinweis in Klammern steht). */
function amountAfter(text: string, label: RegExp): number | null {
  const m = new RegExp(label.source, 'i').exec(text)
  if (!m) return null
  const window = text.slice(m.index + m[0].length, m.index + m[0].length + 160)
  const a = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/.exec(window)
  return a ? parseMoney(a[1]) : null
}

const LABELS = {
  ref: /Reservierungs\s*-?\s*numm\s*er/,
  name: /Vor-?\s*und\s+Nachname/,
  phone: /Tel\.?\s*:?\s*\(?\s*mobil\s*\)?/,
  email: /E-?\s*Mail(?:-?Adresse)?/,
  language: /Sprache/,
  vehicle: /Informationen\s+zum\s+Fahrzeug/,
  plate: /Auto\s*kennzeichen|Kennzeichen/,
  persons: /Anzahl\s+Personen/,
  parkform: /Parkform/,
  transfer: /Transfer\s*-?\s*Typ/,
  flightOut: /Flugnummer\s+Hinreise/,
  flightReturn: /Flugnummer\s+R(?:ü|ue)ckreise/,
  arrivalDate: /Ankunftsdatum\s+Parkplatz/,
  arrivalTime: /Zeitpunkt\s+Ankunft\s+Parkplatz/,
  returnDate: /Datum\s+R(?:ü|ue)ckkehr\s+Flughafen/,
  returnTime: /Zeitpunkt\s+R(?:ü|ue)ckkehr\s+Flughafen/,
  payout: /Gesamtumsatz\s+ParkHandling[^\n\t\d€]*/,
  total: /Gesamtbetrag\s+Kunde/,
}

/** Abschnitt „Kundendaten“ bis zum Abschnitt „Parkplatz“ (dort steht die Betriebsnummer). */
function customerSection(text: string): string {
  const start = /Kundendaten\s*:?/i.exec(text)
  const from = start ? start.index : 0
  const rest = text.slice(from)
  const end = /(?:^|[\n\t])\s*Parkplatz\s*:/i.exec(rest.slice(start ? start[0].length : 0))
  return end ? rest.slice(0, (start ? start[0].length : 0) + end.index) : rest
}

const LANGUAGES: [RegExp, string][] = [
  [/^(deutsch|german|duits)/i, 'de'],
  [/^(englisch|english|engels)/i, 'en'],
  [/^(niederl|nederlands|dutch)/i, 'nl'],
  [/^(franz|fran[cç]ais|french)/i, 'fr'],
  [/^(ital)/i, 'it'],
  [/^(span|espa)/i, 'es'],
  [/^(poln|polish|polski)/i, 'pl'],
  [/^(t(ü|ue|u)rk)/i, 'tr'],
]

function languageCode(value: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (/^[a-z]{2}$/i.test(v)) return v.toLowerCase()
  return LANGUAGES.find(([re]) => re.test(v))?.[1] ?? null
}

function dateParts(value: string | null): [number, number, number] | null {
  const m = value ? /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(value) : null
  return m ? [Number(m[3]), Number(m[2]), Number(m[1])] : null
}

function timeParts(value: string | null): [number, number] | null {
  const m = value ? /(\d{1,2})[:.](\d{2})/.exec(value) : null
  return m ? [Number(m[1]), Number(m[2])] : null
}

function wallClock(date: string | null, time: string | null): string | null {
  const d = dateParts(date)
  if (!d) return null
  const t = timeParts(time) ?? [0, 0]
  return berlinToIso(d[0], d[1], d[2], t[0], t[1])
}

function emptyToNull(v: string | null): string | null {
  const t = v?.trim()
  return t && t !== '-' && t !== '–' ? t : null
}

const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()

export function findProduct(parkform: string | null, map: ParkosProduct[]): ParkosProduct | null {
  if (!parkform) return null
  const key = normLabel(parkform)
  return map.find((p) => normLabel(p.parkos_label) === key) ?? null
}

// ---------------------------------------------------------------------------
// Mailtyp
// ---------------------------------------------------------------------------

export function detectMailType(subject: string | null, text: string): MailType {
  const head = `${subject ?? ''}\n${text.slice(0, 3000)}`
  if (/neue\s+Reservierung\s+(?:über|via|bei)\s+Parkos/i.test(head)) return 'new'
  if (/(storniert|stornierung|annulliert|cancel)/i.test(head)) return 'cancel'
  if (/(geändert|änderung|umbuchung|umgebucht|aktualisiert|modifi)/i.test(head)) return 'change'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

export function readParkosFields(text: string): ParkosFields {
  const customer = customerSection(text)
  const phone = emptyToNull(field(customer, LABELS.phone))
  const email = emptyToNull(field(customer, LABELS.email))
  const personsRaw = emptyToNull(field(text, LABELS.persons))
  const personsNum = personsRaw ? Number(/\d+/.exec(personsRaw)?.[0]) : NaN
  return {
    externalRef: emptyToNull(field(text, LABELS.ref))?.replace(/^#/, '').split(/\s/)[0] ?? null,
    customerName: emptyToNull(field(text, LABELS.name)),
    customerPhone: phone,
    customerEmail: email && /@/.test(email) ? email : null,
    language: emptyToNull(field(text, LABELS.language)),
    vehicleModel: emptyToNull(field(text, LABELS.vehicle)),
    plateRaw: emptyToNull(field(text, LABELS.plate)),
    persons: Number.isInteger(personsNum) ? personsNum : null,
    parkform: emptyToNull(field(text, LABELS.parkform)),
    transfer: emptyToNull(field(text, LABELS.transfer)),
    flightOut: emptyToNull(field(text, LABELS.flightOut)),
    flightReturn: emptyToNull(field(text, LABELS.flightReturn)),
    arrivalDate: emptyToNull(field(text, LABELS.arrivalDate)),
    arrivalTime: emptyToNull(field(text, LABELS.arrivalTime)),
    returnDate: emptyToNull(field(text, LABELS.returnDate)),
    returnTime: emptyToNull(field(text, LABELS.returnTime)),
    totalCustomer: amountAfter(text, LABELS.total),
    payout: amountAfter(text, LABELS.payout),
    paidInAdvance: /im\s+Voraus\s+bei\s+Parkos\s+bezahlt/i.test(text),
  }
}

/** Rohmail (eml, HTML oder Text) → Parse-Ergebnis. */
export function parseParkosMail(raw: string, options: ParkosOptions): ParkosParseResult {
  const mail: DecodedMail = decodeMail(raw)
  const text = mail.text.slice(0, MAX_RAW_TEXT)
  const sender = senderAddress(mail.from)
  const mailType = detectMailType(mail.subject, text)
  const f = readParkosFields(text)
  const flags: ImportFlag[] = []
  const errors: string[] = []

  const subjectRef = mail.subject ? /#\s*([A-Z0-9]+)/i.exec(mail.subject)?.[1] ?? null : null
  const externalRef = (f.externalRef ?? subjectRef)?.toUpperCase() ?? null

  // Bei echten Mails (eml) muss der Absender Parkos sein; eingefügter Text hat keinen Absender
  if (mail.format === 'eml' && !(sender && /@(?:[\w-]+\.)*parkos\.(?:com|de|nl)$/i.test(sender))) {
    flags.push('sender_unverified')
  }

  const plate = f.plateRaw ? normalizePlate(f.plateRaw) : null
  if (plate && !plate.verified) flags.push('plate_unverified')
  if (!f.customerPhone) flags.push('phone_missing')

  const product = findProduct(f.parkform, options.productMap)
  let parkingType: ParkingType | null = product?.parking_type ?? null
  let returnMode: ReturnMode | null = product?.return_mode ?? null
  if (!product) {
    if (options.parkingTypeOverride) {
      parkingType = options.parkingTypeOverride
      returnMode = /shuttle|transfer/i.test(f.parkform ?? '') ? 'shuttle' : null
      flags.push('parking_type_manual')
    } else {
      flags.push('unknown_product')
    }
  }

  const start_at = wallClock(f.arrivalDate, f.arrivalTime)
  const return_flight_at = wallClock(f.returnDate, f.returnTime)
  const end_at = return_flight_at
    ? new Date(new Date(return_flight_at).getTime() + options.bufferMinutes * 60_000).toISOString()
    : null

  if (!externalRef) errors.push('Reservierungsnummer fehlt')
  if (!f.customerName) errors.push('Name fehlt')
  if (!plate) errors.push('Kennzeichen fehlt')
  if (!start_at) errors.push('Ankunft am Parkplatz fehlt')
  if (!return_flight_at) errors.push('Rückkehr am Flughafen fehlt')
  if (start_at && end_at && end_at <= start_at) errors.push('Rückkehr liegt vor der Ankunft')

  const booking: BookingInput | null =
    errors.length === 0 && mailType !== 'unknown'
      ? {
          external_ref: externalRef,
          received_at: mail.date,
          customer_name: f.customerName!,
          customer_phone: f.customerPhone,
          customer_email: f.customerEmail,
          customer_language: languageCode(f.language),
          plate: plate!.plate,
          vehicle_model: f.vehicleModel,
          persons: f.persons ?? 1,
          start_at: start_at!,
          end_at: end_at!,
          return_flight_at,
          flight_out: f.flightOut ? normalizeFlightNo(f.flightOut) : null,
          flight_return: f.flightReturn ? normalizeFlightNo(f.flightReturn) : null,
          transfer_note: f.transfer,
          // parking_type fehlt nur bei unbekannter Parkform; dann legt die DB nichts an (needs_review)
          parking_type: (parkingType ?? 'outdoor') as ParkingType,
          return_mode: returnMode,
          price_total: f.totalCustomer,
          payment_status: f.paidInAdvance ? 'paid' : 'open',
          // Notizen bleiben unberührt, damit ein erneuter Import keine Mitarbeiter-Notizen überschreibt
        }
      : null

  return {
    mailType,
    subject: mail.subject,
    sender,
    receivedAt: mail.date,
    externalRef,
    fields: f,
    booking,
    portalPayout: f.payout,
    flags,
    errors,
    text,
  }
}

/** Datensatz für die Datenbankfunktion `import_booking_mail` (manuell und IMAP identisch). */
export function toImportPayload(result: ParkosParseResult, channel: 'manual' | 'imap') {
  return {
    source: PARKOS_SOURCE,
    channel,
    mail_type: result.mailType,
    subject: result.subject,
    sender: result.sender,
    received_at: result.receivedAt,
    external_ref: result.externalRef,
    raw_text: result.text,
    parsed: { fields: result.fields, errors: result.errors },
    flags: result.flags,
    booking: result.booking,
    portal_payout: result.portalPayout,
  }
}
