// Serverseitige Prüfung einer Landingpage-Anfrage. Maßgeblich ist diese Prüfung; die Landingpage
// prüft dieselben Regeln nur für schnelle Rückmeldung im Formular (landing/src/lib/validation.ts).

export const PARKING_TYPES = ['indoor', 'outdoor_cover', 'outdoor', 'any'] as const
export const SERVICES = ['shuttle', 'detailing', 'pickup_delivery'] as const
export type ParkingType = (typeof PARKING_TYPES)[number]
export type Service = (typeof SERVICES)[number]

export const LIMITS = {
  plate: 15,
  name: 100,
  email: 254,
  phone: 30,
  message: 1000,
  utm: 200,
  referrer: 500,
} as const

/** Anreise höchstens so viele Tage im Voraus */
export const MAX_ADVANCE_DAYS = 365

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

export interface InquiryInput {
  arrival_date: string
  pickup_date: string
  parking_type: ParkingType
  plate: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  services: Service[]
  message: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  referrer: string | null
}

export type ValidationResult =
  | { ok: true; value: InquiryInput }
  | { ok: false; errors: Record<string, string> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^[0-9+()/\-\s]{5,30}$/
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Heutiges Datum in Europe/Berlin als YYYY-MM-DD */
export function todayInBerlin(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = ISO_DATE_RE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** YYYY-MM-DD → TT.MM.JJJJ */
export function formatDateDE(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optional(value: unknown, max: number): string | null {
  const v = text(value)
  return v ? v.slice(0, max) : null
}

export function validateInquiry(raw: unknown, today: string): ValidationResult {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: Record<string, string> = {}

  const arrival = input.arrival_date
  const pickup = input.pickup_date
  if (!isIsoDate(arrival)) errors.arrival_date = 'Bitte ein gültiges Anreisedatum angeben.'
  else if (arrival < today) errors.arrival_date = 'Die Anreise darf nicht in der Vergangenheit liegen.'
  else if (arrival > addDays(today, MAX_ADVANCE_DAYS))
    errors.arrival_date = 'Anfragen sind höchstens ein Jahr im Voraus möglich.'
  if (!isIsoDate(pickup)) errors.pickup_date = 'Bitte ein gültiges Abholdatum angeben.'
  else if (isIsoDate(arrival) && pickup <= arrival)
    errors.pickup_date = 'Die Abholung muss nach der Anreise liegen.'

  const parkingType = input.parking_type
  if (!PARKING_TYPES.includes(parkingType as ParkingType)) errors.parking_type = 'Bitte eine Stellplatzart wählen.'

  const plate = text(input.plate).toUpperCase()
  if (!plate) errors.plate = 'Bitte das Kennzeichen angeben.'
  else if (plate.length > LIMITS.plate) errors.plate = `Höchstens ${LIMITS.plate} Zeichen.`

  const firstName = text(input.first_name)
  const lastName = text(input.last_name)
  if (!firstName) errors.first_name = 'Bitte den Vornamen angeben.'
  else if (firstName.length > LIMITS.name) errors.first_name = `Höchstens ${LIMITS.name} Zeichen.`
  if (!lastName) errors.last_name = 'Bitte den Nachnamen angeben.'
  else if (lastName.length > LIMITS.name) errors.last_name = `Höchstens ${LIMITS.name} Zeichen.`

  const email = text(input.email)
  if (!email) errors.email = 'Bitte die E-Mail-Adresse angeben.'
  else if (email.length > LIMITS.email || !EMAIL_RE.test(email))
    errors.email = 'Bitte eine gültige E-Mail-Adresse angeben.'

  const phone = text(input.phone)
  if (phone && !PHONE_RE.test(phone)) errors.phone = 'Bitte eine gültige Telefonnummer angeben.'

  const rawServices = input.services ?? []
  const services = Array.isArray(rawServices) ? [...new Set(rawServices)] : null
  if (!services || !services.every((s) => SERVICES.includes(s as Service)))
    errors.services = 'Ungültige Leistung ausgewählt.'

  const message = text(input.message)
  if (message.length > LIMITS.message) errors.message = `Höchstens ${LIMITS.message} Zeichen.`

  if (input.consent_privacy !== true) errors.consent_privacy = 'Bitte den Datenschutzhinweis bestätigen.'

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const utm = (input.utm && typeof input.utm === 'object' ? input.utm : {}) as Record<string, unknown>
  return {
    ok: true,
    value: {
      arrival_date: arrival as string,
      pickup_date: pickup as string,
      parking_type: parkingType as ParkingType,
      plate,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
      services: services as Service[],
      message: message || null,
      utm_source: optional(utm.utm_source, LIMITS.utm),
      utm_medium: optional(utm.utm_medium, LIMITS.utm),
      utm_campaign: optional(utm.utm_campaign, LIMITS.utm),
      utm_content: optional(utm.utm_content, LIMITS.utm),
      utm_term: optional(utm.utm_term, LIMITS.utm),
      referrer: optional(input.referrer, LIMITS.referrer),
    },
  }
}
