import { describe, expect, it } from 'vitest'
import {
  emptyManualForm,
  formFromBooking,
  joinNotesExtras,
  manualAdapter,
  normalizeFlightNo,
  splitName,
  splitNotesExtras,
  suggestPickupFromLanding,
} from './manual'
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

describe('Felder wie auf der Website', () => {
  it('setzt den Namen aus Vor- und Nachname zusammen', () => {
    const res = manualAdapter.normalize({ ...baseForm(), customer_name: '', first_name: ' Maria ', last_name: 'de la Cruz' })
    expect(res.ok && res.booking.customer_name).toBe('Maria de la Cruz')
  })

  it('nimmt bei älteren Entwürfen das Feld „Kunde“', () => {
    const res = manualAdapter.normalize(baseForm())
    expect(res.ok && res.booking.customer_name).toBe('Testkunde Parkos')
  })

  it('ohne Namen ist ein Fehler', () => {
    const res = manualAdapter.normalize({ ...baseForm(), customer_name: '' })
    expect(res.ok).toBe(false)
  })

  it('teilt Namen am ersten Leerzeichen', () => {
    expect(splitName('Maria de la Cruz')).toEqual({ first_name: 'Maria', last_name: 'de la Cruz' })
    expect(splitName('Madonna')).toEqual({ first_name: 'Madonna', last_name: '' })
  })

  it('sendet den Tarif; leer = kein Tarif, ältere Entwürfe ohne Feld lassen ihn unverändert', () => {
    const withTariff = manualAdapter.normalize({ ...baseForm(), tariff_code: 'premium', parking_type: 'indoor' })
    expect(withTariff.ok && withTariff.booking.tariff_code).toBe('premium')
    const none = manualAdapter.normalize({ ...baseForm(), tariff_code: '' })
    expect(none.ok && none.booking.tariff_code).toBeNull()
    const old = baseForm() as Partial<ReturnType<typeof baseForm>>
    delete old.tariff_code
    const res = manualAdapter.normalize(old as ReturnType<typeof baseForm>)
    expect(res.ok && 'tariff_code' in res.booking).toBe(false)
  })

  it('schreibt Kindersitze und Gepäckstücke wie Online-Buchungen in die Notiz', () => {
    const res = manualAdapter.normalize({ ...baseForm(), notes: 'Dachbox', child_seats: '1', luggage: '3' })
    expect(res.ok && res.booking.notes).toBe('Dachbox\nKindersitze: 1 · Gepäckstücke: 3')
    const empty = manualAdapter.normalize(baseForm())
    expect(empty.ok && empty.booking.notes).toBeNull()
    const bad = manualAdapter.normalize({ ...baseForm(), child_seats: '7' })
    expect(bad.ok).toBe(false)
  })

  it('liest Kindersitze und Gepäckstücke aus der Notiz und schreibt sie unverändert zurück', () => {
    const notes = 'Hier mal ein Test\nKindersitze: 0 · Gepäckstücke: 2\nAGB 2026-10 akzeptiert'
    const parts = splitNotesExtras(notes)
    expect(parts).toEqual({ notes: 'Hier mal ein Test\nAGB 2026-10 akzeptiert', child_seats: '0', luggage: '2' })
    expect(joinNotesExtras(parts.notes, parts.child_seats, parts.luggage)).toBe(
      'Hier mal ein Test\nAGB 2026-10 akzeptiert\nKindersitze: 0 · Gepäckstücke: 2',
    )
    expect(splitNotesExtras('ohne Angaben')).toEqual({ notes: 'ohne Angaben', child_seats: '', luggage: '' })
  })

  it('übernimmt Name, Tarif und Notiz-Angaben einer Online-Buchung ins Formular', () => {
    const b = {
      id: 'y', external_ref: 'PF-1', customer_name: 'Erika Mustermann', company: null, customer_email: null,
      customer_phone: null, plate: 'M-AB 1', vehicle_model: null, fuel_type: 'electric', persons: 2,
      start_at: '2026-11-25T08:00:00Z', end_at: '2026-11-30T08:00:00Z', parking_type: 'outdoor',
      tariff_code: 'economy', return_mode: 'self', price_total: 49, payment_status: 'open',
      notes: 'Kindersitze: 1 · Gepäckstücke: 2', flight_out: null, flight_return: null,
      return_flight_at: null, customer_language: null, transfer_note: null,
    } as unknown as Booking
    const form = formFromBooking(b, [])
    expect(form.first_name).toBe('Erika')
    expect(form.last_name).toBe('Mustermann')
    expect(form.tariff_code).toBe('economy')
    expect(form.child_seats).toBe('1')
    expect(form.luggage).toBe('2')
    expect(form.notes).toBe('')
  })
})
