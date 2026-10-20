// Buchungsformular der Landingpage: Felder (wie in der Park Handling App), Auswahlwerte und
// Anzeige-Hilfen. Maßgeblich ist die Edge Function booking-checkout – diese Werte dienen nur der Anzeige.
import { daysBetween, isIsoDate } from './dates'

export const MIN_DAYS = 5
export const MAX_DAYS = 30

export const RETURN_OPTIONS = [
  { value: 'shuttle', label: 'Shuttle' },
  { value: 'pickup_delivery', label: 'Hol- & Bringservice' },
  { value: 'self', label: 'Selbst' },
] as const

export const FUEL_OPTIONS = [
  { value: 'combustion', label: 'Verbrenner' },
  { value: 'electric', label: 'Elektro' },
  { value: 'hybrid', label: 'Hybrid' },
] as const

export type PriceTier = 'week' | 'holiday' | 'month'

export const TIER_LABEL: Record<PriceTier, string> = {
  week: 'Wochenpreis (5 bis 8 Tage)',
  holiday: 'Ferienpreis (9 bis 15 Tage)',
  month: 'Monatspreis (16 bis 30 Tage)',
}

export interface BookingForm {
  arrival_date: string
  arrival_time: string
  pickup_date: string
  pickup_time: string
  tariff_code: string
  plate: string
  vehicle_model: string
  fuel_type: string
  persons: string
  return_mode: string
  first_name: string
  last_name: string
  company: string
  email: string
  phone: string
  notes: string
  consent_privacy: boolean
  /** Honeypot – bleibt bei Menschen leer */
  website: string
}

export const EMPTY_FORM: BookingForm = {
  arrival_date: '',
  arrival_time: '',
  pickup_date: '',
  pickup_time: '',
  tariff_code: '',
  plate: '',
  vehicle_model: '',
  fuel_type: '',
  persons: '1',
  return_mode: 'shuttle',
  first_name: '',
  last_name: '',
  company: '',
  email: '',
  phone: '',
  notes: '',
  consent_privacy: false,
  website: '',
}

/** Kalendertage zwischen Anreise und Abholung, null wenn die Daten noch nicht stimmen */
export function rentalDays(form: Pick<BookingForm, 'arrival_date' | 'pickup_date'>): number | null {
  if (!isIsoDate(form.arrival_date) || !isIsoDate(form.pickup_date)) return null
  const days = daysBetween(form.arrival_date, form.pickup_date)
  return days > 0 ? days : null
}

export function tierForDays(days: number): PriceTier | null {
  if (days < MIN_DAYS || days > MAX_DAYS) return null
  if (days <= 8) return 'week'
  if (days <= 15) return 'holiday'
  return 'month'
}

export function formatEuro(amount: number): string {
  return amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

/** Reihenfolge für den Fokus auf den ersten Fehler */
export const FIELD_ORDER: (keyof BookingForm)[] = [
  'arrival_date',
  'arrival_time',
  'pickup_date',
  'pickup_time',
  'tariff_code',
  'plate',
  'vehicle_model',
  'fuel_type',
  'persons',
  'return_mode',
  'first_name',
  'last_name',
  'company',
  'email',
  'phone',
  'notes',
  'consent_privacy',
]
