import { describe, expect, it } from 'vitest'
import { ticketStep, type ScannedBooking } from './ticket'

const b: ScannedBooking = {
  id: 'b1', status: 'booked', plate: 'M-AB 1', external_ref: 'PH261215-OEC-SH-002',
  has_location: false, intake_final: false, handover_final: false,
}

describe('ticketStep: Annahme', () => {
  it('startet mit dem Annahmeprotokoll', () => {
    expect(ticketStep(b, 'intake')).toEqual({ path: '/protokoll/annahme/b1' })
  })
  it('geht nach dem Protokoll zum Einchecken', () => {
    expect(ticketStep({ ...b, intake_final: true }, 'intake')).toEqual({ path: '/einchecken?booking=b1' })
  })
  it('öffnet das Fahrzeug, wenn es schon steht', () => {
    expect(ticketStep({ ...b, status: 'stored', intake_final: true, has_location: true }, 'intake')).toEqual({ path: '/fahrzeuge/b1' })
  })
  it('meldet storniert und zurückgegeben', () => {
    expect(ticketStep({ ...b, status: 'cancelled' }, 'intake')).toHaveProperty('error')
    expect(ticketStep({ ...b, status: 'completed' }, 'intake')).toHaveProperty('error')
  })
})

describe('ticketStep: Rückgabe', () => {
  it('öffnet das Übergabeprotokoll', () => {
    expect(ticketStep({ ...b, status: 'stored', intake_final: true, has_location: true }, 'handover'))
      .toEqual({ path: '/protokoll/uebergabe/b1' })
  })
  it('zeigt das Fahrzeug, wenn schon übergeben', () => {
    expect(ticketStep({ ...b, status: 'completed', handover_final: true }, 'handover')).toEqual({ path: '/fahrzeuge/b1' })
  })
  it('lehnt Rückgabe ohne Annahme ab', () => {
    expect(ticketStep(b, 'handover')).toEqual({ error: 'M-AB 1 ist noch nicht angenommen.', path: '/fahrzeuge/b1' })
  })
})
