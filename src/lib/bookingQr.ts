// QR-Code einer Buchung für das Fahrzeug-Detail (0.42.0). Der Scanner versteht alle drei Formen und
// startet damit die Annahme:
//  * Rechner-Buchung: derselbe Ticket-Link wie in der Bestätigung des Kunden (aus der Notiz)
//  * Buchungsnummer nach ParkHandling-Schema (PH…, z. B. Telefonbuchungen)
//  * sonst (z. B. Parkos): PF-BOOKING:<Buchungs-ID>

export const TICKET_URL = 'https://parkhandling-rechner.pplx.app/ticket.html#'

export interface BookingQr {
  value: string
  kind: 'ticket' | 'booking_ref' | 'booking_id'
  /** kurzer Text unter dem QR-Code */
  caption: string
}

const PH_REF = /^PH\d{6}-[A-Z+]{2,3}-[A-Z]{2}-\d{3}$/

export function bookingQr(b: { id: string; external_ref: string | null; notes: string | null }): BookingQr {
  const token = /ticket\.html#([0-9a-f]{32})/i.exec(b.notes ?? '')?.[1]
  if (token) return { value: TICKET_URL + token.toLowerCase(), kind: 'ticket', caption: 'Kunden-QR aus der Buchungsbestätigung' }
  const ref = (b.external_ref ?? '').trim().toUpperCase()
  if (PH_REF.test(ref)) return { value: ref, kind: 'booking_ref', caption: 'QR-Code mit der Buchungsnummer' }
  return { value: `PF-BOOKING:${b.id}`, kind: 'booking_id', caption: 'QR-Code dieser Buchung' }
}

/** Dateiname zum Teilen: QR_<Kennzeichen oder Nummer>.png */
export function qrFilename(plate: string, ref: string | null): string {
  const base = (ref || plate || 'Buchung').replace(/[^A-Za-z0-9+-]+/g, '-').replace(/^-|-$/g, '')
  return `QR_${base}.png`
}
