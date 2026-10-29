import { describe, expect, it } from 'vitest'
import { manualAdapter } from '../booking-adapters'
import { formFromInquiry, type Inquiry } from './landing'

const inquiry: Inquiry = {
  id: 'i1',
  created_at: '2026-10-27T09:15:00Z',
  arrival_date: '2026-11-03',
  pickup_date: '2026-11-10',
  parking_type: 'indoor',
  plate: 'M-TE 123',
  first_name: 'Max',
  last_name: 'Muster',
  email: 'max@example.com',
  phone: '0171 1234567',
  services: ['shuttle', 'detailing'],
  message: 'Dachbox',
  status: 'new',
  converted_booking_id: null,
  utm_source: null,
  utm_campaign: null,
}

describe('formFromInquiry', () => {
  it('belegt Kunde, Zeitraum, Parkplatz und Rückgabe vor', () => {
    const f = formFromInquiry(inquiry)
    expect(f).toMatchObject({
      id: null,
      customer_name: 'Max Muster',
      customer_email: 'max@example.com',
      customer_phone: '0171 1234567',
      plate: 'M-TE 123',
      start_date: '2026-11-03',
      end_date: '2026-11-10',
      parking_type: 'indoor',
      return_mode: 'shuttle',
    })
    expect(f.notes).toBe('Aus Anfrage vom 27.10.2026\nAufbereitung gewünscht (Umfang klären)\nDachbox')
  })

  it('„egal“ wird Außen, Hol- & Bring geht vor Shuttle, ohne Transfer selbst', () => {
    expect(formFromInquiry({ ...inquiry, parking_type: 'any' }).parking_type).toBe('outdoor')
    expect(formFromInquiry({ ...inquiry, services: ['shuttle', 'pickup_delivery'] }).return_mode).toBe('pickup_delivery')
    expect(formFromInquiry({ ...inquiry, services: [], message: null }).return_mode).toBe('self')
  })

  it('ergibt ein gültiges Buchungsformular', () => {
    expect(manualAdapter.normalize(formFromInquiry(inquiry)).ok).toBe(true)
  })
})
