import { describe, expect, it } from 'vitest'
import { bookingQr, qrFilename } from './bookingQr'
import { parseScan } from './siteplan'

const id = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'

describe('bookingQr', () => {
  it('nimmt bei Rechner-Buchungen den Ticket-Link aus der Notiz', () => {
    const qr = bookingQr({ id, external_ref: 'PH261215-OEC-SH-002',
      notes: 'Kindersitze: 0\nCheck-in-Ticket: https://parkhandling-rechner.pplx.app/ticket.html#0123456789ABCDEF0123456789abcdef' })
    expect(qr.kind).toBe('ticket')
    expect(qr.value).toBe('https://parkhandling-rechner.pplx.app/ticket.html#0123456789abcdef0123456789abcdef')
    expect(parseScan(qr.value).kind).toBe('ticket')
  })
  it('nimmt sonst die PH-Buchungsnummer', () => {
    const qr = bookingQr({ id, external_ref: 'ph261126-oec-sh-001', notes: null })
    expect(qr).toMatchObject({ kind: 'booking_ref', value: 'PH261126-OEC-SH-001' })
    expect(parseScan(qr.value).kind).toBe('booking_ref')
  })
  it('nimmt ohne beides die Buchungs-ID (z. B. Parkos)', () => {
    const qr = bookingQr({ id, external_ref: 'PK-123456', notes: 'Parkos' })
    expect(qr).toMatchObject({ kind: 'booking_id', value: `PF-BOOKING:${id}` })
    expect(parseScan(qr.value)).toEqual({ kind: 'booking_id', code: id })
  })
  it('baut einen Dateinamen', () => {
    expect(qrFilename('M-AB 1234', 'PH261126-OEC-SH-001')).toBe('QR_PH261126-OEC-SH-001.png')
    expect(qrFilename('M-AB 1234', null)).toBe('QR_M-AB-1234.png')
  })
})
