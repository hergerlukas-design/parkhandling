import type { ParkingType, ReturnMode } from '../types/domain'
import { cleanPlate, cleanText, parseDateTime } from './parse'
import type { BookingAdapter, NormalizeResult } from './types'

/** Rohdaten aus dem Formular „Neue Buchung“ (Datum/Zeit als Berliner Ortszeit). */
export interface ManualBookingForm {
  external_ref: string
  customer_name: string
  customer_email: string
  customer_phone: string
  plate: string
  vehicle_model: string
  persons: string
  start_date: string // JJJJ-MM-TT (input type=date)
  start_time: string // HH:MM
  end_date: string
  end_time: string
  parking_type: ParkingType
  return_mode: ReturnMode
  services: string[]
  notes: string
}

export const emptyManualForm = (): ManualBookingForm => ({
  external_ref: '',
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  plate: '',
  vehicle_model: '',
  persons: '1',
  start_date: '',
  start_time: '',
  end_date: '',
  end_time: '',
  parking_type: 'outdoor',
  return_mode: 'shuttle',
  services: [],
  notes: '',
})

export const manualAdapter: BookingAdapter<ManualBookingForm> = {
  source: 'manual',
  normalize(form): NormalizeResult {
    const errors: string[] = []
    const customer_name = cleanText(form.customer_name)
    const plate = cleanPlate(form.plate)
    const start_at = parseDateTime(form.start_date, form.start_time || '00:00')
    const end_at = parseDateTime(form.end_date, form.end_time || '00:00')
    const email = cleanText(form.customer_email)

    if (!customer_name) errors.push('Kundenname fehlt')
    if (!plate) errors.push('Kennzeichen fehlt')
    if (!start_at) errors.push('Ankunft fehlt')
    if (!end_at) errors.push('Abholung fehlt')
    if (start_at && end_at && end_at <= start_at) errors.push('Abholung muss nach der Ankunft liegen')
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('E-Mail-Adresse ungültig')
    const persons = Number(form.persons || 1)
    if (!Number.isInteger(persons) || persons < 0 || persons > 50) errors.push('Personenzahl ungültig')

    if (errors.length) return { ok: false, errors }
    return {
      ok: true,
      warnings: [],
      booking: {
        external_ref: cleanText(form.external_ref) || null,
        customer_name,
        customer_email: email || null,
        customer_phone: cleanText(form.customer_phone) || null,
        plate,
        vehicle_model: cleanText(form.vehicle_model) || null,
        persons,
        start_at: start_at!,
        end_at: end_at!,
        parking_type: form.parking_type,
        return_mode: form.return_mode,
        services: form.services,
        notes: form.notes.trim() || null,
      },
    }
  },
}
