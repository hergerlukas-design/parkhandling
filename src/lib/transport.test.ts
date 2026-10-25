import { describe, expect, it } from 'vitest'
import {
  capacityState,
  driverOrder,
  moveTargets,
  nextStatus,
  passengerTimeHint,
  routeLabel,
  driverShuttleHint,
  meetingTerminal,
  tripLabel,
  splitByDirection,
  summarize,
  waitAfterLanding,
  type TransportJob,
  type TransportPassenger,
} from './transport'

let n = 0
function passenger(patch: Partial<TransportPassenger> = {}): TransportPassenger {
  n += 1
  return {
    id: `p${n}`,
    booking_id: `b${n}`,
    persons: 2,
    manual: false,
    plate: `M-T ${n}`,
    vehicle_model: null,
    customer_name: 'Test',
    customer_phone: null,
    customer_language: 'de',
    flight: 'LH123',
    terminal: 'T2',
    start_at: '2026-10-26T09:00:00Z',
    return_flight_at: '2026-10-29T15:00:00Z',
    end_at: '2026-10-29T16:00:00Z',
    parking_type: 'outdoor',
    booking_status: 'booked',
    ...patch,
  }
}

function job(patch: Partial<TransportJob> = {}): TransportJob {
  n += 1
  const passengers = patch.passengers ?? [passenger()]
  return {
    id: `j${n}`,
    type: 'shuttle_slot',
    direction: 'to_airport',
    scheduled_at: '2026-10-26T10:00:00Z',
    status: 'planned',
    driver_id: null,
    driver_name: null,
    meeting_point: null,
    note: null,
    persons: passengers.reduce((s, p) => s + p.persons, 0),
    capacity: 8,
    passengers,
    ...patch,
  }
}

describe('Shuttle-Dispo', () => {
  it('Kapazität: ok, voll, überbucht', () => {
    expect(capacityState({ persons: 7, capacity: 8 })).toBe('ok')
    expect(capacityState({ persons: 8, capacity: 8 })).toBe('full')
    expect(capacityState({ persons: 9, capacity: 8 })).toBe('over')
  })

  it('Statusfolge geplant → unterwegs → erledigt', () => {
    expect(nextStatus('planned')?.to).toBe('underway')
    expect(nextStatus('assigned')?.label).toBe('Losfahren')
    expect(nextStatus('underway')?.to).toBe('done')
    expect(nextStatus('done')).toBeNull()
  })

  it('Wartezeit am Terminal nur für Rückfahrten', () => {
    const p = passenger({ return_flight_at: '2026-10-29T15:00:00Z' })
    expect(waitAfterLanding({ direction: 'from_airport', type: 'shuttle_slot', scheduled_at: '2026-10-29T16:00:00Z' }, p)).toBe(60)
    expect(waitAfterLanding({ direction: 'to_airport', type: 'shuttle_slot', scheduled_at: '2026-10-29T16:00:00Z' }, p)).toBeNull()
    expect(waitAfterLanding({ direction: 'to_airport', type: 'pickup_delivery', scheduled_at: '2026-10-29T15:30:00Z' }, p)).toBe(30)
  })

  it('Zeithinweis: Ankunft am Platz bzw. Landung (Europe/Berlin)', () => {
    const p = passenger({ start_at: '2026-10-26T09:00:00Z', return_flight_at: '2026-10-29T15:00:00Z' })
    expect(passengerTimeHint({ direction: 'to_airport', type: 'shuttle_slot' }, p)).toBe('Ankunft Platz 10:00')
    expect(passengerTimeHint({ direction: 'from_airport', type: 'shuttle_slot' }, p)).toBe('Landung 16:00')
    expect(passengerTimeHint({ direction: 'from_airport', type: 'shuttle_slot' }, { ...p, return_flight_at: null })).toBe('Abholung Platz 17:00')
    // Hol- & Bring: Übernahme zur Ankunftszeit, Rückgabe nach Landung
    expect(passengerTimeHint({ direction: 'from_airport', type: 'pickup_delivery' }, p)).toBe('Übergabe 10:00')
    expect(passengerTimeHint({ direction: 'to_airport', type: 'pickup_delivery' }, p)).toBe('Landung 16:00')
  })

  it('Zusammenfassung zählt nur Fahrten mit Fahrgästen', () => {
    const jobs = [
      job({ persons: 9, passengers: [passenger({ persons: 4 }), passenger({ persons: 5 })] }),
      job({ status: 'done', driver_id: 'd1' }),
      job({ passengers: [], persons: 0 }),
    ]
    expect(summarize(jobs)).toEqual({ trips: 2, persons: 11, open: 1, over: 1, unassigned: 1 })
  })

  it('Aufteilung nach Richtung und Uhrzeit', () => {
    const a = job({ direction: 'from_airport', scheduled_at: '2026-10-26T15:00:00Z' })
    const b = job({ direction: 'to_airport', scheduled_at: '2026-10-26T12:00:00Z' })
    const c = job({ direction: 'to_airport', scheduled_at: '2026-10-26T08:00:00Z' })
    const split = splitByDirection([a, b, c])
    expect(split.to_airport.map((j) => j.id)).toEqual([c.id, b.id])
    expect(split.from_airport.map((j) => j.id)).toEqual([a.id])
  })

  it('Fahreransicht: eigene und offene Fahrten, erledigte zuletzt', () => {
    const done = job({ status: 'done', driver_id: 'd1', scheduled_at: '2026-10-26T06:00:00Z' })
    const later = job({ driver_id: 'd1', scheduled_at: '2026-10-26T12:00:00Z' })
    const other = job({ driver_id: 'd2', scheduled_at: '2026-10-26T07:00:00Z' })
    const free = job({ driver_id: null, scheduled_at: '2026-10-26T09:00:00Z' })
    expect(driverOrder([done, later, other, free], 'd1').map((j) => j.id)).toEqual([free.id, later.id, done.id])
    expect(driverOrder([done, later, other]).map((j) => j.id)).toEqual([other.id, later.id, done.id])
  })

  it('Umsetzen nur in offene Fahrten derselben Richtung', () => {
    const current = job({ direction: 'to_airport' })
    const same = job({ direction: 'to_airport', scheduled_at: '2026-10-26T11:00:00Z' })
    const underway = job({ direction: 'to_airport', status: 'underway' })
    const other = job({ direction: 'from_airport' })
    expect(moveTargets([current, same, underway, other], current).map((j) => j.id)).toEqual([same.id])
  })
  it('Hol- & Bring: Bezeichnung, Route, kein Umsetzen, keine Überbuchung', () => {
    const valet = job({ type: 'pickup_delivery', direction: 'from_airport', persons: 9, passengers: [passenger({ persons: 9 })] })
    const other = job({ type: 'pickup_delivery', direction: 'from_airport' })
    expect(tripLabel(valet)).toBe('Übernahme am Terminal')
    expect(tripLabel({ type: 'pickup_delivery', direction: 'to_airport' })).toBe('Rückgabe am Terminal')
    expect(tripLabel({ type: 'shuttle_slot', direction: 'to_airport' })).toBe('Zum Flughafen')
    expect(routeLabel(valet)).toBe('Terminal: Auto übernehmen → Platz')
    expect(moveTargets([valet, other], valet)).toEqual([])
    expect(summarize([valet]).over).toBe(0)
  })

  it('Shuttle-Fahrgäste nur in Shuttle-Fahrten umsetzen', () => {
    const current = job({ direction: 'to_airport' })
    const valet = job({ type: 'pickup_delivery', direction: 'to_airport' })
    expect(moveTargets([current, valet], current)).toEqual([])
  })
  it('Hol- & Bring: Terminal und Shuttle des Fahrers', () => {
    const hin = job({ type: 'pickup_delivery', direction: 'from_airport', driver_shuttle_at: '2026-10-26T08:00:00Z' })
    const zurueck = job({ type: 'pickup_delivery', direction: 'to_airport', driver_shuttle_at: null })
    expect(driverShuttleHint(hin)).toBe('Fahrer hin mit Shuttle 09:00')
    expect(driverShuttleHint(zurueck)).toBe('Fahrer: kein Shuttle zurück – selbst organisieren')
    expect(driverShuttleHint(job())).toBeNull()
    expect(meetingTerminal(hin)).toBe('T2')
  })
})
