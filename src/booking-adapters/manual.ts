import type { Booking, FuelType, ParkingType, PaymentStatus, ReturnMode } from '../types/domain'
import { cleanPlate, cleanText, parseDateTime, parseMoney } from './parse'
import type { BookingAdapter, NormalizeResult, ServiceInput } from './types'

export interface ManualServiceEntry {
  /** Preis als Eingabetext (Dezimalkomma erlaubt), leer = individuell / ohne Preis */
  price: string
  description: string
}

/** Rohdaten aus dem Formular „Buchung anlegen/bearbeiten“ (Datum/Zeit als Berliner Ortszeit). */
export interface ManualBookingForm {
  /** gesetzt beim Bearbeiten */
  id: string | null
  external_ref: string
  /** Vor- und Nachname wie auf der Website; customer_name nur noch für ältere Entwürfe */
  first_name: string
  last_name: string
  customer_name: string
  company: string
  customer_email: string
  customer_phone: string
  plate: string
  vehicle_model: string
  fuel_type: FuelType | ''
  persons: string
  start_date: string // JJJJ-MM-TT (input type=date)
  start_time: string // HH:MM
  end_date: string
  end_time: string
  /** Tarif wie auf der Website (economy, space, business, premium); leer = ohne Tarif (Portal-Import) */
  tariff_code: string
  parking_type: ParkingType
  return_mode: ReturnMode
  /** Anzahl Kindersitze und Gepäckstücke (stehen wie bei Online-Buchungen in der Notiz), leer = keine Angabe */
  child_seats: string
  luggage: string
  /** Leistungscode → Preis/Beschreibung (nur ausgewählte Leistungen) */
  services: Record<string, ManualServiceEntry>
  price_total: string
  payment_status: PaymentStatus
  notes: string
  /** Flug & Transfer (optional, z. B. aus Parkos) */
  flight_out: string
  flight_return: string
  return_flight_date: string // JJJJ-MM-TT
  return_flight_time: string // HH:MM
  customer_language: string // ISO 639-1 oder leer
  transfer_note: string
}

/**
 * Puffer zwischen Landung und Abholung am Platz. Wandert mit dem Parkos-Import nach
 * `settings.return_buffer_minutes`; bis dahin Standardwert (ANNAHMEN.md: 60 min).
 */
export const DEFAULT_RETURN_BUFFER_MINUTES = 60

/** Flugnummer vereinheitlichen: Großbuchstaben, ohne Leerzeichen ("lh 123" → "LH123"). */
export function normalizeFlightNo(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '')
}

/**
 * Abholung am Platz aus der Landung vorschlagen (Datum/Zeit als Berliner Ortszeit).
 * Gibt null zurück, wenn Datum oder Uhrzeit der Landung fehlen.
 */
export function suggestPickupFromLanding(
  date: string,
  time: string,
  bufferMinutes = DEFAULT_RETURN_BUFFER_MINUTES,
): { date: string; time: string } | null {
  if (!date || !time) return null
  const landing = parseDateTime(date, time)
  if (!landing) return null
  return berlinParts(new Date(new Date(landing).getTime() + bufferMinutes * 60_000).toISOString())
}

export const emptyManualForm = (): ManualBookingForm => ({
  id: null,
  external_ref: '',
  first_name: '',
  last_name: '',
  customer_name: '',
  company: '',
  customer_email: '',
  customer_phone: '',
  plate: '',
  vehicle_model: '',
  fuel_type: '',
  persons: '1',
  start_date: '',
  start_time: '',
  end_date: '',
  end_time: '',
  tariff_code: '',
  parking_type: 'outdoor',
  return_mode: 'shuttle',
  child_seats: '',
  luggage: '',
  services: {},
  price_total: '',
  payment_status: 'open',
  notes: '',
  flight_out: '',
  flight_return: '',
  return_flight_date: '',
  return_flight_time: '',
  customer_language: '',
  transfer_note: '',
})

const berlinParts = (iso: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

const moneyText = (n: number | null) =>
  n === null || n === undefined ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** „Maria de la Cruz“ → Vorname „Maria“, Nachname „de la Cruz“ (Trennung am ersten Leerzeichen) */
export function splitName(name: string): { first_name: string; last_name: string } {
  const t = name.trim().replace(/\s+/g, ' ')
  const i = t.indexOf(' ')
  return i < 0 ? { first_name: t, last_name: '' } : { first_name: t.slice(0, i), last_name: t.slice(i + 1) }
}

/** Vollständiger Name aus dem Formular (Vor- und Nachname, sonst Feld „Kunde“ älterer Entwürfe) */
export function formCustomerName(form: Pick<ManualBookingForm, 'first_name' | 'last_name' | 'customer_name'>): string {
  const full = cleanText(`${form.first_name ?? ''} ${form.last_name ?? ''}`)
  return full || cleanText(form.customer_name ?? '')
}

/** Zeile der Online-Buchung „Kindersitze: 0 · Gepäckstücke: 2“ */
const EXTRAS_LINE = /^Kindersitze: (\d+) · Gepäckstücke: (\d+)$/m

/** Kindersitze und Gepäckstücke aus der Notiz lösen; die übrige Notiz bleibt unverändert */
export function splitNotesExtras(notes: string): { notes: string; child_seats: string; luggage: string } {
  const m = EXTRAS_LINE.exec(notes)
  if (!m) return { notes, child_seats: '', luggage: '' }
  const rest = (notes.slice(0, m.index) + notes.slice(m.index + m[0].length)).replace(/\n{2,}/g, '\n').replace(/^\n|\n$/g, '')
  return { notes: rest, child_seats: m[1], luggage: m[2] }
}

/** Notiz mit Kindersitzen und Gepäckstücken (nur wenn mindestens eins angegeben ist) */
export function joinNotesExtras(notes: string, childSeats: string, luggage: string): string {
  const text = notes.trim()
  if (!childSeats.trim() && !luggage.trim()) return text
  const line = `Kindersitze: ${Number(childSeats || 0)} · Gepäckstücke: ${Number(luggage || 0)}`
  return text ? `${text}\n${line}` : line
}

/** Formular aus bestehender Buchung (Bearbeiten). */
export function formFromBooking(
  b: Booking,
  services: { code: string; is_default: boolean; price_at_booking: number | null; description: string | null; status: string }[],
): ManualBookingForm {
  const start = berlinParts(b.start_at)
  const end = berlinParts(b.end_at)
  const landing = b.return_flight_at ? berlinParts(b.return_flight_at) : null
  const extras = splitNotesExtras(b.notes ?? '')
  return {
    id: b.id,
    external_ref: b.external_ref ?? '',
    ...splitName(b.customer_name),
    customer_name: '',
    company: b.company ?? '',
    customer_email: b.customer_email ?? '',
    customer_phone: b.customer_phone ?? '',
    plate: b.plate,
    vehicle_model: b.vehicle_model ?? '',
    fuel_type: b.fuel_type ?? '',
    persons: String(b.persons),
    start_date: start.date,
    start_time: start.time,
    end_date: end.date,
    end_time: end.time,
    tariff_code: b.tariff_code ?? '',
    parking_type: b.parking_type,
    return_mode: b.return_mode,
    ...extras,
    services: Object.fromEntries(
      services
        .filter((s) => s.status === 'active' && !s.is_default)
        .map((s) => [s.code, { price: moneyText(s.price_at_booking), description: s.description ?? '' }]),
    ),
    price_total: moneyText(b.price_total),
    payment_status: b.payment_status,
    notes: extras.notes,
    flight_out: b.flight_out ?? '',
    flight_return: b.flight_return ?? '',
    return_flight_date: landing?.date ?? '',
    return_flight_time: landing?.time ?? '',
    customer_language: b.customer_language ?? '',
    transfer_note: b.transfer_note ?? '',
  }
}

export const manualAdapter: BookingAdapter<ManualBookingForm> = {
  source: 'manual',
  normalize(form): NormalizeResult {
    const errors: string[] = []
    const customer_name = formCustomerName(form)
    const plate = cleanPlate(form.plate)
    const start_at = parseDateTime(form.start_date, form.start_time || '00:00')
    const end_at = parseDateTime(form.end_date, form.end_time || '00:00')
    const email = cleanText(form.customer_email)

    if (!customer_name) errors.push('Name fehlt')
    if (!plate) errors.push('Kennzeichen fehlt')
    if (!start_at) errors.push('Anreise fehlt')
    if (!end_at) errors.push('Abholung fehlt')
    if (start_at && end_at && end_at <= start_at) errors.push('Abholung muss nach der Anreise liegen')
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('E-Mail-Adresse ungültig')
    const persons = Number(form.persons || 1)
    if (!Number.isInteger(persons) || persons < 0 || persons > 50) errors.push('Personenzahl ungültig')
    const childSeats = (form.child_seats ?? '').trim()
    const luggage = (form.luggage ?? '').trim()
    if (childSeats && !/^[0-5]$/.test(childSeats)) errors.push('Kindersitze: 0 bis 5')
    if (luggage && !(/^\d{1,2}$/.test(luggage) && Number(luggage) <= 20)) errors.push('Gepäckstücke: 0 bis 20')
    // Entwürfe aus älteren Versionen kennen die Flugfelder noch nicht → leer behandeln
    const landingDate = form.return_flight_date ?? ''
    const landingTime = form.return_flight_time ?? ''
    let return_flight_at: string | null = null
    if (landingDate || landingTime) {
      return_flight_at = landingDate ? parseDateTime(landingDate, landingTime || '00:00') : null
      if (!return_flight_at) errors.push('Landung Rückflug ungültig (Datum fehlt?)')
    }
    const price_total = parseMoney(form.price_total)
    if (form.price_total.trim() && price_total === null) errors.push('Gesamtpreis ungültig')

    const services: ServiceInput[] = []
    for (const [code, entry] of Object.entries(form.services)) {
      const price = parseMoney(entry.price)
      if (entry.price.trim() && price === null) errors.push(`Preis für ${code} ungültig`)
      services.push({ code, price, description: entry.description.trim() || null })
    }

    if (errors.length) return { ok: false, errors }
    return {
      ok: true,
      warnings: [],
      booking: {
        ...(form.id ? { id: form.id } : {}),
        external_ref: cleanText(form.external_ref) || null,
        customer_name,
        company: cleanText(form.company) || null,
        customer_email: email || null,
        customer_phone: cleanText(form.customer_phone) || null,
        plate,
        vehicle_model: cleanText(form.vehicle_model) || null,
        fuel_type: form.fuel_type || null,
        persons,
        start_at: start_at!,
        end_at: end_at!,
        parking_type: form.parking_type,
        // Ältere Entwürfe kennen den Tarif nicht → Tarif der Buchung nicht anfassen
        ...(form.tariff_code !== undefined ? { tariff_code: form.tariff_code || null } : {}),
        return_mode: form.return_mode,
        services,
        price_total,
        payment_status: form.payment_status,
        notes: joinNotesExtras(form.notes, childSeats, luggage) || null,
        flight_out: normalizeFlightNo(form.flight_out ?? '') || null,
        flight_return: normalizeFlightNo(form.flight_return ?? '') || null,
        return_flight_at,
        customer_language: (form.customer_language ?? '').trim().toLowerCase() || null,
        transfer_note: cleanText(form.transfer_note ?? '') || null,
      },
    }
  },
}
