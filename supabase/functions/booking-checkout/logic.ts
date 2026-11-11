// Reine Logik der Online-Buchung (ohne Deno-/Supabase-Abhängigkeiten, damit testbar).
// Regeln (Preismodell der Website, ANNAHMEN.md):
//  * Dauer wie im Website-Rechner: Anreise- und Abreisetag zählen jeweils als voller Tag
//    (Abholdatum − Anreisedatum + 1, Uhrzeiten zählen nicht)
//  * Betrag = Grundpreis (bis 5 Tage) + Preis je weiterem Tag; Mindestdauer 5, höchstens 30 Tage
//  * Preise brutto in EUR

export const TIME_ZONE = 'Europe/Berlin'
export const MIN_DAYS = 5
export const MAX_DAYS = 30
/** So viele Tage deckt der Grundpreis ab; jeder weitere Tag kostet extra_day_price */
export const INCLUDED_DAYS = 5
export const MAX_ADVANCE_DAYS = 365
/** Online buchbar bis so viele Stunden vor der Anreise */
export const MIN_LEAD_HOURS = 12
/** Widerrufsfrist in Tagen (AGB Ziffer 12.2 / Belehrung) */
export const WITHDRAWAL_DAYS = 14

export const MAX_CHILD_SEATS = 5
export const MAX_LUGGAGE = 30
export const LIMITS = { plate: 15, name: 100, company: 100, email: 254, phone: 30, vehicle: 60, notes: 1000, chargingTarget: 40 }

export const RETURN_MODES = ['shuttle', 'pickup_delivery', 'self'] as const
export const FUEL_TYPES = ['combustion', 'electric', 'hybrid'] as const
export type ReturnMode = (typeof RETURN_MODES)[number]
export type FuelType = (typeof FUEL_TYPES)[number]
export const LANGUAGES = ['de', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

/** Tarif-Codes, die der Website-Rechner anders nennt (?tarif=carcover → space) */
export const TARIFF_ALIASES: Record<string, string> = { carcover: 'space' }

export function normalizeTariffCode(code: unknown): string {
  const c = typeof code === 'string' ? code.trim().toLowerCase() : ''
  return TARIFF_ALIASES[c] ?? c
}

export interface TariffRow {
  code: string
  label: string
  parking_type: 'indoor' | 'outdoor_cover' | 'outdoor'
  shuttle_text: string
  included_text: string
  /** Grundpreis für bis zu 5 Tage */
  base_price: number
  /** Preis je weiterem Tag ab dem 6. Tag */
  extra_day_price: number
  /** Altes Modell nach Dauerklassen, nicht mehr genutzt */
  price_week?: number
  price_holiday?: number
  price_month?: number
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
  /** Laden gewünscht (Website-Rechner); Abrechnung bei Rückgabe, der Betrag ändert sich nicht */
  charging?: boolean | string
  /** Ladeziel, z. B. „80 %“ */
  charging_target?: string | number
  /** Sprache des Kunden: de | en */
  language?: string
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
  amount: number
  early_start: boolean
  flight_outbound: string | null
  flight_return: string | null
  child_seats: number
  luggage: number
  charging?: boolean
  charging_target?: string | null
  language?: Language | null
  /** Anreise innerhalb der Widerrufsfrist, aber keine ausdrückliche Zustimmung übermittelt (nur register) */
  early_start_unconfirmed?: boolean
  accepted_at: string
}

/** Prüfregeln: checkout = Landingpage (streng), register = Website-Rechner (an dessen Formular angepasst) */
export interface ValidationOptions {
  /** Shuttle verlangt beide Flugnummern (Rechner: freiwillig, fehlende werden in der Notiz vermerkt) */
  requireFlights: boolean
  /** Anreise innerhalb von 14 Tagen verlangt das Häkchen consent_early_start (Rechner hat es nicht) */
  requireEarlyStartConsent: boolean
}

export const CHECKOUT_RULES: ValidationOptions = { requireFlights: true, requireEarlyStartConsent: true }
export const REGISTER_RULES: ValidationOptions = { requireFlights: false, requireEarlyStartConsent: false }

/** Zusätzliche Felder, die der Website-Rechner so sendet */
export interface RegisterExtras {
  /** Ein gemeinsames Feld für beide Flüge, z. B. „LH 2020 / LH 2021“ */
  flights?: string
}

/** „TT.MM.JJJJ“ oder „JJJJ-MM-TT“ → „JJJJ-MM-TT“; sonst unverändert (die Prüfung meldet den Fehler) */
export function normalizeDate(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : ''
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`
  return v.slice(0, 10)
}

/** „9:00“, „09:00 Uhr“, „09:00:00“ → „09:00“; sonst unverändert */
export function normalizeTime(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : ''
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?(?:\s*uhr)?$/i.exec(v)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : v
}

/** „LH 2020 / LH 2021“ → [„LH 2020“, „LH 2021“] (Trenner: / , ; oder „und“) */
export function splitFlights(value: unknown): [string, string] {
  const v = typeof value === 'string' ? value.trim() : ''
  const parts = v.split(/\s*(?:\/|,|;|\bund\b|\band\b)\s*/i).filter(Boolean)
  return [parts[0] ?? '', parts[1] ?? '']
}

/**
 * Eingaben des Website-Rechners vereinheitlichen, bevor sie geprüft werden: Datums- und Zeitformate,
 * ein gemeinsames Flugnummern-Feld, fehlende Personen (1) und Gepäckstücke (0).
 */
export function normalizeRegisterInput(input: Partial<BookingInput> & RegisterExtras): BookingInput {
  const f = { ...input } as BookingInput & RegisterExtras
  f.arrival_date = normalizeDate(f.arrival_date)
  f.pickup_date = normalizeDate(f.pickup_date)
  f.arrival_time = normalizeTime(f.arrival_time)
  f.pickup_time = normalizeTime(f.pickup_time)
  const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
  if (blank(f.flight_outbound) && blank(f.flight_return) && !blank(f.flights)) {
    ;[f.flight_outbound, f.flight_return] = splitFlights(f.flights)
  }
  if (blank(f.persons)) f.persons = 1
  if (blank(f.luggage)) f.luggage = 0
  if (blank(f.child_seats)) f.child_seats = 0
  for (const k of ['company', 'phone', 'vehicle_model', 'fuel_type', 'notes', 'website'] as const) if (blank(f[k])) f[k] = ''
  return f
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

/** Berechnete Tage wie im Website-Rechner: Anreise- und Abreisetag zählen jeweils als voller Tag */
export function rentalDays(arrival: string, pickup: string): number {
  return daysBetween(arrival, pickup) + 1
}

/** Heutiges Datum in Europe/Berlin als YYYY-MM-DD */
export function todayInBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Online buchbar? (Mindest- und Höchstdauer) */
export function bookableDays(days: number): boolean {
  return Number.isInteger(days) && days >= MIN_DAYS && days <= MAX_DAYS
}

/** Betrag = Grundpreis (bis 5 Tage) + Preis je weiterem Tag, auf Cent gerundet */
export function priceFor(tariff: Pick<TariffRow, 'base_price' | 'extra_day_price'>, days: number): number {
  const extra = Math.max(0, days - INCLUDED_DAYS)
  return Math.round((Number(tariff.base_price) + extra * Number(tariff.extra_day_price)) * 100) / 100
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
  rules: ValidationOptions = CHECKOUT_RULES,
): { errors: BookingErrors; value: NormalizedBooking | null } {
  const e: BookingErrors = {}
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  if (str(input.website)) e.website = 'Ungültige Anfrage.'

  if (!isIsoDate(input.arrival_date)) e.arrival_date = 'Bitte ein Anreisedatum wählen.'
  else if (input.arrival_date < today) e.arrival_date = 'Die Anreise darf nicht in der Vergangenheit liegen.'
  else if (input.arrival_date > addDays(today, MAX_ADVANCE_DAYS)) e.arrival_date = 'Buchungen sind höchstens 365 Tage im Voraus möglich.'

  if (!TIME_RE.test(str(input.arrival_time))) e.arrival_time = 'Bitte eine Uhrzeit wählen.'

  // Vorlauf: Anreise frühestens 12 Stunden nach der Buchung
  if (!e.arrival_date && !e.arrival_time) {
    const earliest = Date.parse(acceptedAt) + MIN_LEAD_HOURS * 3_600_000
    if (Date.parse(berlinToUtcIso(input.arrival_date, str(input.arrival_time))) < earliest) {
      const msg = `Online buchbar bis ${MIN_LEAD_HOURS} Stunden vor der Anreise.`
      if (input.arrival_date < todayInBerlin(new Date(earliest))) e.arrival_date = msg
      else e.arrival_time = msg
    }
  }

  if (!isIsoDate(input.pickup_date)) e.pickup_date = 'Bitte ein Abholdatum wählen.'
  if (!TIME_RE.test(str(input.pickup_time))) e.pickup_time = 'Bitte eine Uhrzeit wählen.'

  let days = 0
  if (isIsoDate(input.arrival_date) && isIsoDate(input.pickup_date)) {
    days = rentalDays(input.arrival_date, input.pickup_date)
    if (days <= 0) e.pickup_date = 'Die Abholung muss nach der Anreise liegen.'
    else if (days < MIN_DAYS) e.pickup_date = `Online buchbar ab ${MIN_DAYS} Tagen. Bei kürzerer Dauer bitte direkt anfragen.`
    else if (days > MAX_DAYS) e.pickup_date = `Online buchbar bis höchstens ${MAX_DAYS} Tage. Bei längerer Dauer bitte direkt anfragen.`
  }

  const tariff = tariffs.find((t) => t.code === normalizeTariffCode(input.tariff_code) && t.active)
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
  const earlyConsent = input.consent_early_start === true
  if (earlyStart && !earlyConsent && rules.requireEarlyStartConsent)
    e.consent_early_start = 'Bitte der Leistung vor Ablauf der Widerrufsfrist ausdrücklich zustimmen.'

  const flightOut = str(input.flight_outbound)
  const flightBack = str(input.flight_return)
  const flightRe = /^[A-Za-z0-9 \-]{2,20}$/
  if (ret === 'shuttle' && rules.requireFlights) {
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

  const charging = input.charging === true || (typeof input.charging === 'string' && /^(true|1|ja|yes)$/i.test(input.charging.trim()))
  const chargingTarget =
    typeof input.charging_target === 'number' ? `${input.charging_target} %` : str(input.charging_target)
  if (chargingTarget.length > LIMITS.chargingTarget) e.charging_target = `Höchstens ${LIMITS.chargingTarget} Zeichen.`

  const language = str(input.language).toLowerCase()
  if (language && !(LANGUAGES as readonly string[]).includes(language)) e.language = 'Ungültige Auswahl.'

  if (Object.keys(e).length > 0 || !tariff) return { errors: e, value: null }

  if (!bookableDays(days)) return { errors: { pickup_date: 'Dauer nicht buchbar.' }, value: null }

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
      amount: priceFor(tariff, days),
      early_start: earlyStart,
      flight_outbound: flightOut || null,
      flight_return: flightBack || null,
      child_seats: childSeats,
      luggage,
      charging,
      charging_target: charging ? chargingTarget || null : null,
      language: (language || null) as Language | null,
      early_start_unconfirmed: earlyStart && !earlyConsent,
      accepted_at: acceptedAt,
    },
  }
}

/** Flugnummer wie in der App (Großbuchstaben, ohne Leerzeichen: „LH 1234“ → „LH1234“) */
export function normalizeFlightNo(value: string | null): string | null {
  const v = (value ?? '').toUpperCase().replace(/\s+/g, '')
  return v || null
}

/**
 * Zeile für bookings nach erfolgter Zahlung. Tarif und Flugnummern stehen in eigenen Feldern
 * (die App zeigt sie an, im Tarif enthaltene Leistungen bucht ein Trigger); die Notiz enthält
 * nur, was es dafür nicht gibt. Die Zeile „Vorzeitiger Leistungsbeginn“ wertet der Widerruf aus.
 */
export function bookingRow(
  value: NormalizedBooking,
  tariff: Pick<TariffRow, 'code' | 'parking_type'>,
  orderId: string,
  agbVersion: string,
  receivedAt: string = new Date().toISOString(),
) {
  const shuttle = value.return_mode === 'shuttle'
  const notes = [
    value.notes,
    `Kindersitze: ${value.child_seats} · Gepäckstücke: ${value.luggage}`,
    value.charging
      ? `Laden: ja${value.charging_target ? ` · Ladeziel: ${value.charging_target}` : ''} (${CHARGING_BILLING_NOTE})`
      : null,
    `AGB ${agbVersion} akzeptiert (${value.accepted_at}), Widerrufsbelehrung zur Kenntnis genommen`,
    shuttle && (!value.flight_outbound || !value.flight_return) ? 'Flugnummern fehlen – bitte beim Kunden erfragen' : null,
    `Vorzeitiger Leistungsbeginn: ${
      !value.early_start
        ? 'nicht relevant (Anreise außerhalb der Widerrufsfrist)'
        : value.early_start_unconfirmed
          ? 'Anreise innerhalb der Widerrufsfrist, keine ausdrückliche Zustimmung übermittelt'
          : 'ausdrücklich zugestimmt'
    }`,
  ]
    .filter(Boolean)
    .join('\n')
  return {
    source: 'landing',
    external_ref: orderId,
    received_at: receivedAt,
    customer_name: value.customer_name,
    company: value.company,
    customer_email: value.email,
    customer_phone: value.phone,
    plate: value.plate,
    vehicle_model: value.vehicle_model,
    fuel_type: value.fuel_type,
    persons: value.persons,
    start_at: berlinToUtcIso(value.arrival_date, value.arrival_time),
    end_at: berlinToUtcIso(value.pickup_date, value.pickup_time),
    parking_type: tariff.parking_type,
    tariff_code: tariff.code,
    return_mode: value.return_mode,
    flight_out: shuttle ? normalizeFlightNo(value.flight_outbound) : null,
    flight_return: shuttle ? normalizeFlightNo(value.flight_return) : null,
    status: 'booked',
    price_total: value.amount,
    payment_status: 'paid',
    customer_language: value.language ?? null,
    notes,
  }
}

/** Abrechnung des Ladens bei Rückgabe; der Buchungsbetrag enthält es nicht */
export const CHARGING_BILLING_NOTE = 'Abrechnung bei Rückgabe: 0,69 €/kWh + 10,00 € je Ladevorgang'

/** Quelle der Buchungen aus dem Website-Rechner (register) */
export const WEBSITE_SOURCE = 'website'

/**
 * Zeile für bookings aus dem Website-Rechner (Aktion register): ohne PayPal-Order, Zahlung offen.
 * Die Buchungs-ID wird vorab vergeben, damit die PF-Nummer als external_ref gespeichert werden kann.
 */
export function registerRow(
  value: NormalizedBooking,
  tariff: Pick<TariffRow, 'code' | 'parking_type'>,
  id: string,
  agbVersion: string,
  receivedAt: string = new Date().toISOString(),
) {
  return {
    ...bookingRow(value, tariff, bookingRefFor(id), agbVersion, receivedAt),
    id,
    source: WEBSITE_SOURCE,
    payment_status: 'open',
  }
}

/** Beschreibung der gebuchten Leistung „Laden“ */
export function chargingDescription(value: Pick<NormalizedBooking, 'charging_target'>): string {
  return [value.charging_target ? `Ladeziel: ${value.charging_target}` : null, CHARGING_BILLING_NOTE].filter(Boolean).join(' · ')
}

/** Meldung, wenn der Bereich des Tarifs im Zeitraum ausgebucht ist */
export function areaFullMessage(parkingType: TariffRow['parking_type']): string {
  const area = parkingType === 'indoor' ? 'Die Halle ist' : parkingType === 'outdoor_cover' ? 'Der Außenbereich mit Plane ist' : 'Der Außenbereich ist'
  return `${area} im gewählten Zeitraum ausgebucht. Bitte einen anderen Tarif oder Zeitraum wählen.`
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

// -----------------------------------------------------------------------------
// Online-Widerruf (AGB Ziffer 12.2, Widerrufsbelehrung)
// -----------------------------------------------------------------------------

/** Buchungsnummer aus der Buchungs-ID, wie in der Bestätigung */
export function bookingRefFor(id: string): string {
  return `PF-${id.slice(0, 8).toUpperCase()}`
}

export const BOOKING_REF_RE = /^PF-[0-9A-F]{8}$/

export interface WithdrawalInput {
  booking_ref: string
  email: string
  name: string
  reason: string
  /** Erklärung des Widerrufs (Pflicht) */
  consent_withdraw: boolean
  /** Honeypot – muss leer sein */
  website: string
}

export type WithdrawalErrors = Partial<Record<keyof WithdrawalInput, string>>

export function validateWithdrawal(input: WithdrawalInput): WithdrawalErrors {
  const e: WithdrawalErrors = {}
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  if (str(input.website)) e.website = 'Ungültige Anfrage.'
  const ref = str(input.booking_ref).toUpperCase()
  if (!BOOKING_REF_RE.test(ref)) e.booking_ref = 'Bitte die Buchungsnummer angeben (Format PF-XXXXXXXX).'
  const email = str(input.email)
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) e.email = 'Bitte eine gültige E-Mail-Adresse angeben.'
  const name = str(input.name)
  if (!name || name.length > LIMITS.name) e.name = 'Bitte Vor- und Nachnamen angeben.'
  if (str(input.reason).length > 500) e.reason = 'Höchstens 500 Zeichen.'
  if (input.consent_withdraw !== true) e.consent_withdraw = 'Bitte bestätigen Sie den Widerruf.'
  return e
}

/** Berliner Ortszeit als „TT.MM.JJJJ, HH:MM Uhr“ */
export function formatBerlinDateTime(date: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  )
  return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute} Uhr`
}

export function withdrawalMails(args: {
  bookingRef: string
  customerName: string
  email: string
  receivedAt: Date
  reason: string | null
  withinPeriod: boolean
  earlyStart: boolean
}): { customer: { subject: string; text: string }; staff: { subject: string; text: string } } {
  const received = formatBerlinDateTime(args.receivedAt)
  const customerLines = [
    `Hallo ${args.customerName},`,
    '',
    'wir bestätigen den Eingang Ihrer Widerrufserklärung. Dies ist Ihre Eingangsbestätigung.',
    '',
    `Buchungsnummer: ${args.bookingRef}`,
    `Eingegangen am: ${received} (Berliner Zeit)`,
    'Inhalt: Sie widerrufen den Vertrag über die oben genannte Buchung.',
  ]
  if (args.reason) customerLines.push(`Ihr Hinweis: ${args.reason}`)
  customerLines.push(
    '',
    'Die Rückzahlung erfolgt unverzüglich, spätestens binnen 14 Tagen nach Eingang dieser Erklärung, mit demselben Zahlungsmittel (PayPal), sofern nichts anderes vereinbart ist. Dafür werden Ihnen keine Entgelte berechnet.',
  )
  if (args.earlyStart)
    customerLines.push(
      'Sie haben den Beginn der Leistung vor Ablauf der Widerrufsfrist verlangt. Für bereits erbrachte Leistungen ist daher ein anteiliger Betrag zu zahlen. Dazu melden wir uns mit einer Abrechnung.',
    )
  customerLines.push('', 'Mit freundlichen Grüßen', 'Park & Fly München')

  const staffLines = [
    `Widerruf eingegangen: ${args.bookingRef}`,
    '',
    `Kunde:           ${args.customerName} (${args.email})`,
    `Eingegangen am:  ${received}`,
    `Innerhalb 14 Tage: ${args.withinPeriod ? 'ja' : 'NEIN, bitte prüfen'}`,
    `Früher Beginn:   ${args.earlyStart ? 'ja, Abrechnung erbrachter Leistungen nötig' : 'nein'}`,
    `Hinweis:         ${args.reason ?? '–'}`,
    '',
    'Bitte die Rückzahlung über PayPal veranlassen und die Buchung in der App prüfen.',
  ]
  return {
    customer: { subject: `Eingangsbestätigung Widerruf ${args.bookingRef}`, text: customerLines.join('\n') },
    staff: { subject: `Widerruf ${args.bookingRef} eingegangen`, text: staffLines.join('\n') },
  }
}

/** Prüfung für „Bestätigung erneut senden“: nur Buchungsnummer und E-Mail, Honeypot leer */
export function validateLookup(input: { booking_ref: string; email: string; website: string }): Record<string, string> {
  const e: Record<string, string> = {}
  if (input.website.trim()) e.website = 'Ungültige Anfrage.'
  if (!BOOKING_REF_RE.test(input.booking_ref.trim().toUpperCase())) e.booking_ref = 'Bitte die Buchungsnummer angeben (Format PF-XXXXXXXX).'
  const email = input.email.trim()
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) e.email = 'Bitte eine gültige E-Mail-Adresse angeben.'
  return e
}

/** Hinweis an den Betrieb: bezahlte Buchung, aber die Bestätigung ist nicht versendet */
export function confirmationFailedMail(args: {
  bookingRef: string
  customerName: string
  email: string
  amount: number
  error: string
}): { subject: string; text: string } {
  return {
    subject: `Bestätigung NICHT versendet: ${args.bookingRef}`,
    text: [
      `Die Buchung ${args.bookingRef} ist bezahlt (${formatEuro(args.amount)}), aber die Buchungsbestätigung konnte nicht versendet werden.`,
      '',
      `Kunde:  ${args.customerName} (${args.email})`,
      `Fehler: ${args.error}`,
      '',
      'Bitte den Kunden direkt informieren. Der Vertrag entsteht erst mit der Bestätigung (AGB 2.2).',
      'Der Kunde kann die Bestätigung über die Landingpage erneut anfordern, sobald der Mailversand wieder läuft.',
    ].join('\n'),
  }
}
