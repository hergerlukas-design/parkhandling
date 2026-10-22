import { describe, expect, it } from 'vitest'
import { emptyManualForm, formFromBooking, manualAdapter, normalizeFlightNo, suggestPickupFromLanding } from './manual'
import type { Booking } from '../types/domain'

const baseForm = () => ({
  ...emptyManualForm(),
  customer_name: 'Testkunde Parkos',
  plate: 'M-MM 3839',
  start_date: '2026-10-23',
  start_time: '12:00',
  end_date: '2026-10-28',
  end_time: '13:00',
})

describe('Flug- und Transferfelder', () => {
  it('normalisiert Flugnummern', () => {
    expect(normalizeFlightNo(' lh 123 ')).toBe('LH123')
    expect(normalizeFlightNo('')).toBe('')
  })

  it('übernimmt Flüge, Landung, Sprache und Transfer (Landung nach der Zeitumstellung = MEZ)', () => {
    const res = manualAdapter.normalize({
      ...baseForm(),
      flight_out: 'lh123',
      flight_return: 'LH 234',
      return_flight_date: '2026-10-28',
      return_flight_time: '12:00',
      customer_language: 'DE',
      transfer_note: '  Inklusive Transfer (16 Minuten) ',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.booking.flight_out).toBe('LH123')
    expect(res.booking.flight_return).toBe('LH234')
    expect(new Date(res.booking.return_flight_at!).toISOString()).toBe('2026-10-28T11:00:00.000Z')
    expect(res.booking.customer_language).toBe('de')
    expect(res.booking.transfer_note).toBe('Inklusive Transfer (16 Minuten)')
    expect(new Date(res.booking.start_at).toISOString()).toBe('2026-10-23T10:00:00.000Z')
  })

  it('leere Felder werden null', () => {
    const res = manualAdapter.normalize(baseForm())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.booking.flight_out).toBeNull()
    expect(res.booking.return_flight_at).toBeNull()
    expect(res.booking.customer_language).toBeNull()
  })

  it('Uhrzeit der Landung ohne Datum ist ein Fehler', () => {
    const res = manualAdapter.normalize({ ...baseForm(), return_flight_time: '12:00' })
    expect(res.ok).toBe(false)
  })

  it('verträgt Entwürfe älterer Versionen ohne Flugfelder', () => {
    const old = baseForm() as Partial<ReturnType<typeof baseForm>>
    delete old.flight_out
    delete old.return_flight_date
    delete old.return_flight_time
    const res = manualAdapter.normalize(old as ReturnType<typeof baseForm>)
    expect(res.ok).toBe(true)
  })

  it('schlägt Abholung = Landung + 60 min vor, auch über Mitternacht', () => {
    expect(suggestPickupFromLanding('2026-10-28', '12:00')).toEqual({ date: '2026-10-28', time: '13:00' })
    expect(suggestPickupFromLanding('2026-10-28', '23:30')).toEqual({ date: '2026-10-29', time: '00:30' })
    expect(suggestPickupFromLanding('2026-10-28', '')).toBeNull()
  })

  it('befüllt das Formular aus einer Buchung', () => {
    const b = {
      id: 'x',
      external_ref: '494PHBR',
      customer_name: 'Testkunde Parkos',
      company: null,
      customer_email: null,
      customer_phone: null,
      plate: 'M-MM 3839',
      vehicle_model: 'Ford Focus',
      fuel_type: null,
      persons: 1,
      start_at: '2026-10-23T10:00:00Z',
      end_at: '2026-10-28T12:00:00Z',
      parking_type: 'outdoor',
      return_mode: 'shuttle',
      price_total: 72,
      payment_status: 'paid',
      notes: null,
      flight_out: 'LH123',
      flight_return: 'LH234',
      return_flight_at: '2026-10-28T11:00:00Z',
      customer_language: 'de',
      transfer_note: 'Inklusive Transfer (16 Minuten)',
    } as unknown as Booking
    const form = formFromBooking(b, [])
    expect(form.return_flight_date).toBe('2026-10-28')
    expect(form.return_flight_time).toBe('12:00')
    expect(form.end_time).toBe('13:00')
    expect(form.flight_return).toBe('LH234')
    expect(form.customer_language).toBe('de')
  })
})
