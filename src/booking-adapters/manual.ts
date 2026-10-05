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
  parking_type: ParkingType
  return_mode: ReturnMode
  /** Leistungscode → Preis/Beschreibung (nur ausgewählte Leistungen) */
  services: Record<string, ManualServiceEntry>
  price_total: string
  payment_status: PaymentStatus
  notes: string
}

export const emptyManualForm = (): ManualBookingForm => ({
  id: null,
  external_ref: '',
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
  parking_type: 'outdoor',
  return_mode: 'shuttle',
  services: {},
  price_total: '',
  payment_status: 'open',
  notes: '',
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

/** Formular aus bestehender Buchung (Bearbeiten). */
export function formFromBooking(
  b: Booking,
  services: { code: string; is_default: boolean; price_at_booking: number | null; description: string | null; status: string }[],
): ManualBookingForm {
  const start = berlinParts(b.start_at)
  const end = berlinParts(b.end_at)
  return {
    id: b.id,
    external_ref: b.external_ref ?? '',
    customer_name: b.customer_name,
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
    parking_type: b.parking_type,
    return_mode: b.return_mode,
    services: Object.fromEntries(
      services
        .filter((s) => s.status === 'active' && !s.is_default)
        .map((s) => [s.code, { price: moneyText(s.price_at_booking), description: s.description ?? '' }]),
    ),
    price_total: moneyText(b.price_total),
    payment_status: b.payment_status,
    notes: b.notes ?? '',
  }
}

export const manualAdapter: BookingAdapter<ManualBookingForm> = {
  source: 'manual',
  normalize(form): NormalizeResult {
    const errors: string[] = []
    const customer_name = cleanText(form.customer_name)
    const plate = cleanPlate(form.plate)
    const start_at = parseDateTime(form.start_date, form.start_time || '00:00')
    const end_at = parseDateTime(form.end_date, form.end_time || '00:00')
    const email = cleanText(form.customer_email)

    if (!customer_name) errors.push('Kunde fehlt')
    if (!plate) errors.push('Kennzeichen fehlt')
    if (!start_at) errors.push('Anreise fehlt')
    if (!end_at) errors.push('Abholung fehlt')
    if (start_at && end_at && end_at <= start_at) errors.push('Abholung muss nach der Anreise liegen')
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('E-Mail-Adresse ungültig')
    const persons = Number(form.persons || 1)
    if (!Number.isInteger(persons) || persons < 0 || persons > 50) errors.push('Personenzahl ungültig')
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
        return_mode: form.return_mode,
        services,
        price_total,
        payment_status: form.payment_status,
        notes: form.notes.trim() || null,
      },
    }
  },
}
