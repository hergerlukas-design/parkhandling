// Buchungsformular der Landingpage: Felder (wie in der Park Handling App), Auswahlwerte und
// Anzeige-Hilfen. Maßgeblich ist die Edge Function booking-checkout – diese Werte dienen nur der Anzeige.
import { berlinDateTime, daysBetween, isIsoDate } from './dates'

export const MIN_DAYS = 5
export const MAX_DAYS = 30
/** Online buchbar bis so viele Stunden vor der Anreise (wie in der Edge Function) */
export const MIN_LEAD_HOURS = 12

/** Frühestmögliche Anreise (Berliner Ortszeit): jetzt + 12 Stunden */
export function earliestArrival(now: Date = new Date()): { date: string; time: string } {
  return berlinDateTime(new Date(now.getTime() + MIN_LEAD_HOURS * 3_600_000))
}

/** Anreise liegt vor der frühestmöglichen; ohne vollständige Angaben false */
export function arrivalTooSoon(form: Pick<BookingForm, 'arrival_date' | 'arrival_time'>, now: Date = new Date()): boolean {
  if (!isIsoDate(form.arrival_date)) return false
  const e = earliestArrival(now)
  if (form.arrival_date !== e.date) return form.arrival_date < e.date
  return /^\d{2}:\d{2}$/.test(form.arrival_time) && form.arrival_time < e.time
}

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

/** So viele Tage deckt der Grundpreis ab; jeder weitere Tag kostet extra (wie in der Edge Function) */
export const INCLUDED_DAYS = 5

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
  consent_agb: boolean
  consent_withdrawal: boolean
  /** nur relevant, wenn die Anreise innerhalb der Widerrufsfrist liegt */
  consent_early_start: boolean
  flight_outbound: string
  flight_return: string
  child_seats: string
  luggage: string
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
  consent_agb: false,
  consent_withdrawal: false,
  consent_early_start: false,
  flight_outbound: '',
  flight_return: '',
  child_seats: '0',
  luggage: '',
  website: '',
}

/** Widerrufsfrist in Tagen (AGB Ziffer 12.2) */
export const WITHDRAWAL_DAYS = 14
export const CHILD_SEAT_OPTIONS = [0, 1, 2, 3] as const
export const MAX_LUGGAGE = 30

/** Anreise liegt innerhalb der Widerrufsfrist → ausdrückliche Zustimmung zum frühen Leistungsbeginn nötig */
export function earlyStartRelevant(arrivalDate: string, today: string): boolean {
  if (!isIsoDate(arrivalDate) || arrivalDate < today) return false
  return daysBetween(today, arrivalDate) < WITHDRAWAL_DAYS
}

/** Kalendertage zwischen Anreise und Abholung, null wenn die Daten noch nicht stimmen */
export function rentalDays(form: Pick<BookingForm, 'arrival_date' | 'pickup_date'>): number | null {
  if (!isIsoDate(form.arrival_date) || !isIsoDate(form.pickup_date)) return null
  const days = daysBetween(form.arrival_date, form.pickup_date)
  return days > 0 ? days : null
}

/** Online buchbar? (Mindest- und Höchstdauer) */
export function bookableDays(days: number): boolean {
  return days >= MIN_DAYS && days <= MAX_DAYS
}

/** Betrag = Grundpreis (bis 5 Tage) + Preis je weiterem Tag; maßgeblich ist die Berechnung des Servers */
export function priceForDays(tariff: { base_price: number; extra_day_price: number }, days: number): number {
  return Math.round((tariff.base_price + Math.max(0, days - INCLUDED_DAYS) * tariff.extra_day_price) * 100) / 100
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
  'flight_outbound',
  'flight_return',
  'child_seats',
  'luggage',
  'consent_privacy',
  'consent_agb',
  'consent_withdrawal',
  'consent_early_start',
]
