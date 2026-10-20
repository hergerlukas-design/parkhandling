// Reine Logik der Online-Buchung (ohne Deno-/Supabase-Abhängigkeiten, damit testbar).
// Regeln laut Preiskategorien-Vorlage und ANNAHMEN.md (Landingpage, Stufe 2):
//  * Dauer in Kalendertagen zwischen Anreise und Abholung
//  * 5–8 Tage → Wochenpreis, 9–15 → Ferienpreis, 16–30 → Monatspreis; sonst keine Online-Buchung
//  * Preise brutto in EUR (Annahme, noch zu bestätigen)

export const TIME_ZONE = 'Europe/Berlin'
export const MIN_DAYS = 5
export const MAX_DAYS = 30
export const MAX_ADVANCE_DAYS = 365
/** Widerrufsfrist in Tagen (AGB Ziffer 12.2 / Belehrung) */
export const WITHDRAWAL_DAYS = 14

export const MAX_CHILD_SEATS = 3
export const MAX_LUGGAGE = 30
export const LIMITS = { plate: 15, name: 100, company: 100, email: 254, phone: 30, vehicle: 60, notes: 1000 }

export const RETURN_MODES = ['shuttle', 'pickup_delivery', 'self'] as const
export const FUEL_TYPES = ['combustion', 'electric', 'hybrid'] as const
export type ReturnMode = (typeof RETURN_MODES)[number]
export type FuelType = (typeof FUEL_TYPES)[number]
export type Tier = 'week' | 'holiday' | 'month'

export interface TariffRow {
  code: string
  label: string
  parking_type: 'indoor' | 'outdoor_cover' | 'outdoor'
  shuttle_text: string
  included_text: string
  price_week: number
  price_holiday: number
  price_month: number
  active: boolean
  sort_order: number
}

/** Rohdaten aus dem Formular, wie sie die Edge Function empfängt */
export interface BookingInput {
  arrival_date: string
  arrival_time: string
  pickup_date: string
  pickup_time: string
  tariff_code: string
  plate: string
  first_name: string
  last_name: string
  company: string
  email: string
  phone: string
  vehicle_model: string
  fuel_type: string
  persons: number | string
  return_mode: string
  notes: string
  consent_privacy: boolean
  /** AGB gelesen und akzeptiert (Pflicht) */
  consent_agb: boolean
  /** Widerrufsbelehrung zur Kenntnis genommen (Pflicht) */
  consent_withdrawal: boolean
  /** Ausdrückliche Zustimmung zum Beginn der Leistung vor Ablauf der Widerrufsfrist (nur bei Anreise innerhalb von 14 Tagen) */
  consent_early_start: boolean
  flight_outbound: string
  flight_return: string
  child_seats: number | string
  luggage: number | string
  /** Honeypot – muss leer sein */
  website: string
}

export type BookingErrors = Partial<Record<keyof BookingInput, string>>

export interface NormalizedBooking {
  arrival_date: string
  arrival_time: string
  pickup_date: string
  pickup_time: string
  tariff_code: string
  plate: string
  customer_name: string
  company: string | null
  email: string
  phone: string | null
  vehicle_model: string | null
  fuel_type: FuelType | null
  persons: number
  return_mode: ReturnMode
  notes: string | null
  days: number
  tier: Tier
  amount: number
  early_start: boolean
  flight_outbound: string | null
  flight_return: string | null
  child_seats: number
  luggage: number
  accepted_at: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^[0-9+()/\-\s]{5,30}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Kalendertage zwischen zwei Daten (YYYY-MM-DD) */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  })
  return Math.round((b - a) / 86_400_000)
}

/** Heutiges Datum in Europe/Berlin als YYYY-MM-DD */
export function todayInBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function tierForDays(days: number): Tier | null {
  if (days < MIN_DAYS || days > MAX_DAYS) return null
  if (days <= 8) return 'week'
  if (days <= 15) return 'holiday'
  return 'month'
}

export function priceFor(tariff: Pick<TariffRow, 'price_week' | 'price_holiday' | 'price_month'>, tier: Tier): number {
  return tier === 'week' ? tariff.price_week : tier === 'holiday' ? tariff.price_holiday : tariff.price_month
}

/** Wandzeit in Berlin zu einem UTC-Zeitpunkt → Offset in Minuten */
function berlinOffsetMinutes(utcMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  return (asUtc - utcMs) / 60_000
}

/** Lokale Berliner Zeit (Datum + HH:MM) → ISO-Zeitpunkt mit Offset, z. B. 2026-10-20T18:00:00.000Z */
export function berlinToUtcIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const local = Date.UTC(y, m - 1, d, hh, mm)
  let utc = local - berlinOffsetMinutes(local) * 60_000
  utc = local - berlinOffsetMinutes(utc) * 60_000
  return new Date(utc).toISOString()
}

export function validateBooking(
  input: BookingInput,
  today: string,
  tariffs: TariffRow[],
  acceptedAt: string = new Date().toISOString(),
): { errors: BookingErrors; value: NormalizedBooking | null } {
  const e: BookingErrors = {}
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  if (str(input.website)) e.website = 'Ungültige Anfrage.'

  if (!isIsoDate(input.arrival_date)) e.arrival_date = 'Bitte ein Anreisedatum wählen.'
  else if (input.arrival_date < today) e.arrival_date = 'Die Anreise darf nicht in der Vergangenheit liegen.'
  else if (input.arrival_date > addDays(today, MAX_ADVANCE_DAYS)) e.arrival_date = 'Buchungen sind höchstens 365 Tage im Voraus möglich.'

  if (!TIME_RE.test(str(input.arrival_time))) e.arrival_time = 'Bitte eine Uhrzeit wählen.'

  if (!isIsoDate(input.pickup_date)) e.pickup_date = 'Bitte ein Abholdatum wählen.'
  if (!TIME_RE.test(str(input.pickup_time))) e.pickup_time = 'Bitte eine Uhrzeit wählen.'

  let days = 0
  if (isIsoDate(input.arrival_date) && isIsoDate(input.pickup_date)) {
    days = daysBetween(input.arrival_date, input.pickup_date)
    if (days <= 0) e.pickup_date = 'Die Abholung muss nach der Anreise liegen.'
    else if (days < MIN_DAYS) e.pickup_date = `Online buchbar ab ${MIN_DAYS} Tagen. Bei kürzerer Dauer bitte direkt anfragen.`
    else if (days > MAX_DAYS) e.pickup_date = `Der Monatstarif gilt höchstens ${MAX_DAYS} Tage. Bei längerer Dauer bitte direkt anfragen.`
  }

  const tariff = tariffs.find((t) => t.code === str(input.tariff_code) && t.active)
  if (!tariff) e.tariff_code = 'Bitte einen Tarif wählen.'

  const plate = str(input.plate).toUpperCase()
  if (!plate) e.plate = 'Bitte das Kennzeichen angeben.'
  else if (plate.length > LIMITS.plate) e.plate = `Höchstens ${LIMITS.plate} Zeichen.`

  const first = str(input.first_name)
  const last = str(input.last_name)
  if (!first || first.length > LIMITS.name) e.first_name = 'Bitte den Vornamen angeben.'
  if (!last || last.length > LIMITS.name) e.last_name = 'Bitte den Nachnamen angeben.'

  const company = str(input.company)
  if (company.length > LIMITS.company) e.company = `Höchstens ${LIMITS.company} Zeichen.`

  const email = str(input.email)
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) e.email = 'Bitte eine gültige E-Mail-Adresse angeben.'

  const phone = str(input.phone)
  if (phone && (phone.length > LIMITS.phone || !PHONE_RE.test(phone)))
    e.phone = 'Bitte nur Ziffern, Leerzeichen und + ( ) / - verwenden.'

  const vehicle = str(input.vehicle_model)
  if (vehicle.length > LIMITS.vehicle) e.vehicle_model = `Höchstens ${LIMITS.vehicle} Zeichen.`

  const fuel = str(input.fuel_type)
  if (fuel && !(FUEL_TYPES as readonly string[]).includes(fuel)) e.fuel_type = 'Ungültige Auswahl.'

  const persons = Number(input.persons)
  if (!Number.isInteger(persons) || persons < 1 || persons > 50) e.persons = 'Zwischen 1 und 50 Personen.'

  const ret = str(input.return_mode)
  if (!(RETURN_MODES as readonly string[]).includes(ret)) e.return_mode = 'Bitte eine Rückgabe wählen.'

  const notes = str(input.notes)
  if (notes.length > LIMITS.notes) e.notes = `Höchstens ${LIMITS.notes} Zeichen.`

  if (input.consent_privacy !== true) e.consent_privacy = 'Bitte den Datenschutzhinweis bestätigen.'
  if (input.consent_agb !== true) e.consent_agb = 'Bitte die AGB akzeptieren.'
  if (input.consent_withdrawal !== true) e.consent_withdrawal = 'Bitte die Widerrufsbelehrung zur Kenntnis nehmen.'

  // Anreise innerhalb der Widerrufsfrist: Leistungsbeginn nur mit ausdrücklicher Zustimmung
  const earlyStart =
    isIsoDate(input.arrival_date) && input.arrival_date >= today && daysBetween(today, input.arrival_date) < WITHDRAWAL_DAYS
  if (earlyStart && input.consent_early_start !== true)
    e.consent_early_start = 'Bitte der Leistung vor Ablauf der Widerrufsfrist ausdrücklich zustimmen.'

  const flightOut = str(input.flight_outbound)
  const flightBack = str(input.flight_return)
  const flightRe = /^[A-Za-z0-9 \-]{2,20}$/
  if (ret === 'shuttle') {
    if (!flightRe.test(flightOut)) e.flight_outbound = 'Bitte die Flugnummer des Hinflugs angeben (z. B. LH 1234).'
    if (!flightRe.test(flightBack)) e.flight_return = 'Bitte die Flugnummer des Rückflugs angeben (z. B. LH 1235).'
  } else {
    if (flightOut && !flightRe.test(flightOut)) e.flight_outbound = 'Bitte die Flugnummer des Hinflugs angeben (z. B. LH 1234).'
    if (flightBack && !flightRe.test(flightBack)) e.flight_return = 'Bitte die Flugnummer des Rückflugs angeben (z. B. LH 1235).'
  }

  const childSeats = input.child_seats === '' || input.child_seats == null ? 0 : Number(input.child_seats)
  if (!Number.isInteger(childSeats) || childSeats < 0 || childSeats > MAX_CHILD_SEATS)
    e.child_seats = `Zwischen 0 und ${MAX_CHILD_SEATS} Kindersitze.`

  const luggage = Number(input.luggage)
  if (input.luggage === '' || input.luggage == null || !Number.isInteger(luggage) || luggage < 0 || luggage > MAX_LUGGAGE)
    e.luggage = `Bitte die Anzahl der Gepäckstücke angeben (0 bis ${MAX_LUGGAGE}).`

  if (Object.keys(e).length > 0 || !tariff) return { errors: e, value: null }

  const tier = tierForDays(days)
  if (!tier) return { errors: { pickup_date: 'Dauer nicht buchbar.' }, value: null }

  return {
    errors: {},
    value: {
      arrival_date: input.arrival_date,
      arrival_time: str(input.arrival_time),
      pickup_date: input.pickup_date,
      pickup_time: str(input.pickup_time),
      tariff_code: tariff.code,
      plate,
      customer_name: `${first} ${last}`,
      company: company || null,
      email,
      phone: phone || null,
      vehicle_model: vehicle || null,
      fuel_type: (fuel || null) as FuelType | null,
      persons,
      return_mode: ret as ReturnMode,
      notes: notes || null,
      days,
      tier,
      amount: priceFor(tariff, tier),
      early_start: earlyStart,
      flight_outbound: flightOut || null,
      flight_return: flightBack || null,
      child_seats: childSeats,
      luggage,
      accepted_at: acceptedAt,
    },
  }
}

const RETURN_LABEL: Record<ReturnMode, string> = {
  shuttle: 'Shuttle zum Terminal',
  pickup_delivery: 'Hol- & Bringservice',
  self: 'Selbst',
}

export function formatEuro(amount: number): string {
  return amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

export function formatDateDE(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function confirmationMail(args: {
  bookingRef: string
  booking: NormalizedBooking
  tariffLabel: string
  parkingLabel: string
  agbText: string
  withdrawalText: string
  agbVersion: string
}): { subject: string; text: string } {
  const b = args.booking
  const shuttle = b.return_mode === 'shuttle'
  const lines = [
    `Hallo ${b.customer_name},`,
    '',
    'vielen Dank für Ihre Buchung bei Park & Fly München.',
    '',
    'Hiermit nehmen wir Ihre Buchung verbindlich an. Der Vertrag kommt mit dieser Buchungsbestätigung zustande (AGB Ziffer 2.2).',
    '',
    `Buchungsnummer: ${args.bookingRef}`,
    `Tarif:          ${args.tariffLabel} (${args.parkingLabel})`,
    `Anreise:        ${formatDateDE(b.arrival_date)} ${b.arrival_time} Uhr`,
    `Abholung:       ${formatDateDE(b.pickup_date)} ${b.pickup_time} Uhr`,
    `Dauer:          ${b.days} Tage`,
    `Kennzeichen:    ${b.plate}`,
    `Rückgabe:       ${RETURN_LABEL[b.return_mode]}`,
  ]
  if (shuttle) {
    lines.push(`Flug Hinflug:   ${b.flight_outbound ?? '–'}`)
    lines.push(`Flug Rückflug:  ${b.flight_return ?? '–'}`)
  }
  lines.push(`Kindersitze:    ${b.child_seats}`)
  lines.push(`Gepäckstücke:   ${b.luggage}`)
  lines.push(`Betrag:         ${formatEuro(b.amount)} (brutto, inkl. Umsatzsteuer)`)
  lines.push('Zahlung:        PayPal, bezahlt')
  lines.push(
    '',
    'Stornierung: kostenlos bis 24 Stunden vor Leistungsbeginn, in Textform, insbesondere per E-Mail an fly@parkhandling.com (AGB Ziffer 10.1).',
  )
  if (b.early_start) {
    lines.push(
      '',
      'Sie haben ausdrücklich zugestimmt, dass wir vor Ablauf der Widerrufsfrist mit der vereinbarten Dienstleistung beginnen. Ihr Widerrufsrecht erlischt mit vollständiger Leistungserbringung durch uns.',
    )
  }
  lines.push(
    '',
    `Die AGB (Stand ${args.agbVersion}) und die Widerrufsbelehrung finden Sie vollständig unten in dieser E-Mail. Sie haben beim Buchen bestätigt, dass Sie sie zur Kenntnis genommen haben.`,
    '',
    'Mit freundlichen Grüßen',
    'Park & Fly München',
    '',
    '==================================================',
    'WIDERRUFSBELEHRUNG',
    '==================================================',
    '',
    args.withdrawalText,
    '',
    '==================================================',
    `ALLGEMEINE GESCHÄFTSBEDINGUNGEN (Stand ${args.agbVersion})`,
    '==================================================',
    '',
    args.agbText,
  )
  return { subject: `Buchungsbestätigung ${args.bookingRef}`, text: lines.join('\n') }
}
