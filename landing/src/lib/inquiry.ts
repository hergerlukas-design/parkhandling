// Anfrage-Formular: Auswahlwerte und Prüfregeln.
// Die Edge Function inquiry-submit prüft dieselben Regeln serverseitig und ist maßgeblich;
// hier geht es nur um schnelle Rückmeldung im Formular.
import { addDays, formatDateDE, isIsoDate } from './dates'

export const PARKING_OPTIONS = [
  { value: 'indoor', label: 'Halle Premium (Indoor)' },
  { value: 'outdoor_cover', label: 'Außen mit Abdeckplane' },
  { value: 'outdoor', label: 'Außen ohne Plane' },
  { value: 'any', label: 'Egal, Hauptsache geparkt' },
] as const

export const SERVICE_OPTIONS = [
  { value: 'shuttle', label: 'Shuttle zum Terminal' },
  { value: 'detailing', label: 'Fahrzeugaufbereitung' },
  { value: 'pickup_delivery', label: 'Hol- & Bringservice' },
] as const

export type ParkingType = (typeof PARKING_OPTIONS)[number]['value']
export type Service = (typeof SERVICE_OPTIONS)[number]['value']

export const LIMITS = {
  plate: 15,
  name: 100,
  email: 254,
  phone: 30,
  message: 1000,
} as const

export const MAX_ADVANCE_DAYS = 365

export interface InquiryForm {
  arrival_date: string
  pickup_date: string
  parking_type: ParkingType | ''
  plate: string
  first_name: string
  last_name: string
  email: string
  phone: string
  services: Service[]
  message: string
  consent_privacy: boolean
}

export type InquiryErrors = Partial<Record<keyof InquiryForm, string>>

export const EMPTY_FORM: InquiryForm = {
  arrival_date: '',
  pickup_date: '',
  parking_type: '',
  plate: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  services: [],
  message: '',
  consent_privacy: false,
}

/** Reihenfolge = Reihenfolge im Formular (für den Fokus auf den ersten Fehler) */
export const FIELD_ORDER: (keyof InquiryForm)[] = [
  'arrival_date',
  'pickup_date',
  'parking_type',
  'plate',
  'first_name',
  'last_name',
  'email',
  'phone',
  'services',
  'message',
  'consent_privacy',
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^[0-9+()/\-\s]{5,30}$/

export function isParkingType(value: string | null): value is ParkingType {
  return PARKING_OPTIONS.some((o) => o.value === value)
}

export function validateInquiry(form: InquiryForm, today: string): InquiryErrors {
  const e: InquiryErrors = {}

  if (!isIsoDate(form.arrival_date)) e.arrival_date = 'Bitte ein Anreisedatum wählen.'
  else if (form.arrival_date < today) e.arrival_date = 'Die Anreise darf nicht in der Vergangenheit liegen.'
  else if (form.arrival_date > addDays(today, MAX_ADVANCE_DAYS))
    e.arrival_date = `Anfragen sind bis ${formatDateDE(addDays(today, MAX_ADVANCE_DAYS))} möglich.`

  if (!isIsoDate(form.pickup_date)) e.pickup_date = 'Bitte ein Abholdatum wählen.'
  else if (isIsoDate(form.arrival_date) && form.pickup_date <= form.arrival_date)
    e.pickup_date = `Die Abholung muss nach der Anreise (${formatDateDE(form.arrival_date)}) liegen.`

  if (!isParkingType(form.parking_type)) e.parking_type = 'Bitte eine Stellplatzart wählen.'

  const plate = form.plate.trim()
  if (!plate) e.plate = 'Bitte das Kennzeichen angeben.'
  else if (plate.length > LIMITS.plate) e.plate = `Höchstens ${LIMITS.plate} Zeichen.`

  const first = form.first_name.trim()
  const last = form.last_name.trim()
  if (!first) e.first_name = 'Bitte den Vornamen angeben.'
  else if (first.length > LIMITS.name) e.first_name = `Höchstens ${LIMITS.name} Zeichen.`
  if (!last) e.last_name = 'Bitte den Nachnamen angeben.'
  else if (last.length > LIMITS.name) e.last_name = `Höchstens ${LIMITS.name} Zeichen.`

  const email = form.email.trim()
  if (!email) e.email = 'Bitte die E-Mail-Adresse angeben.'
  else if (email.length > LIMITS.email || !EMAIL_RE.test(email)) e.email = 'Bitte eine gültige E-Mail-Adresse angeben.'

  const phone = form.phone.trim()
  if (phone && !PHONE_RE.test(phone)) e.phone = 'Bitte nur Ziffern, Leerzeichen und + ( ) / - verwenden.'

  if (form.message.trim().length > LIMITS.message) e.message = `Höchstens ${LIMITS.message} Zeichen.`

  if (!form.consent_privacy) e.consent_privacy = 'Bitte den Datenschutzhinweis bestätigen.'

  return e
}
