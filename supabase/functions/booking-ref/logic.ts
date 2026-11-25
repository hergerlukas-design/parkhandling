// Buchungsnummern für Telefonbuchungen (source = 'manual') nach dem ParkHandling-Schema
// PH<JJMMTT Anreise>-<Platz+Tarif>-<Service>-<lfd. Nr.>. Die Nummer vergibt CarHandling
// (gemeinsamer Zähler mit dem Rechner); hier nur die Zuordnung und der Abruf.

export const TARIFF_CODE: Record<string, string> = {
  economy: 'OEC',
  space: 'OE+',
  business: 'IB',
  premium: 'IP',
}

export const SERVICE_CODE: Record<string, string> = {
  shuttle: 'SH',
  self: 'SE',
  pickup_delivery: 'VA',
}

export interface RefBooking {
  id: string
  start_at: string
  tariff_code: string | null
  return_mode: string | null
}

export interface RefRequest {
  arrival_date: string
  tariff: string
  service: string
  reference: string
}

/** Anreisetag in Berliner Zeit (YYYY-MM-DD) */
export function berlinDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** Anfrage an CarHandling oder Grund, warum (noch) keine Nummer möglich ist */
export function refRequest(b: RefBooking): RefRequest | { error: string } {
  const tariff = TARIFF_CODE[b.tariff_code ?? '']
  if (!tariff) return { error: 'Kein Tarif – Buchungsnummer nur mit Tarif' }
  const service = SERVICE_CODE[b.return_mode ?? '']
  if (!service) return { error: 'Rückgabe unbekannt' }
  return { arrival_date: berlinDate(b.start_at), tariff, service, reference: b.id }
}

/** Plausibilitätsprüfung der Antwort (PH + 6 Ziffern + Kürzel + 3 Ziffern) */
export function validRef(ref: unknown): ref is string {
  return typeof ref === 'string' && /^PH\d{6}-(OEC|OE\+|IB|IP)-(SH|SE|VA)-\d{3,}$/.test(ref)
}
