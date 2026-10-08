import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingListItem } from './bookings'
import type { BoardSlot } from './siteplan'
import type { BoardTask } from './tasks'
import { buildToday, periodRange } from './today'

// 06.10.2026 in Europe/Berlin (UTC+2)
const range = {
  today: '2026-10-05T22:00:00.000Z',
  tomorrow: '2026-10-06T22:00:00.000Z',
  dayAfter: '2026-10-07T22:00:00.000Z',
  from: '2026-10-05T22:00:00.000Z',
  to: '2026-10-06T22:00:00.000Z',
  periodWord: 'heute',
  multiDay: false,
}
const now = new Date('2026-10-06T10:40:00Z') // 12:40 Uhr

let n = 0
function booking(patch: Partial<BookingListItem>): BookingListItem {
  n += 1
  return {
    id: `b${n}`,
    plate: `M-T ${n}`,
    vehicle_model: 'Testwagen',
    status: 'stored',
    start_at: '2026-10-01T08:00:00Z',
    end_at: '2026-10-10T08:00:00Z',
    parking_type: 'indoor',
    return_mode: 'shuttle',
    payment_status: 'paid',
    location_code: null,
    location_area: null,
    open_task_count: 0,
    task_chips: [],
    ...patch,
  } as BookingListItem
}

const slots = [
  { area: 'hall', booking_id: 'x' },
  { area: 'hall', booking_id: null },
  { area: 'outdoor_a', booking_id: null },
] as BoardSlot[]

describe('buildToday', () => {
  it('erstellt den Tagesablauf mit Status je Ankunft und Abholung', () => {
    const data = buildToday(
      [
        booking({ id: 'in-done', status: 'stored', start_at: '2026-10-06T07:10:00Z', location_code: 'R8-E3' }),
        booking({ id: 'in-late', status: 'booked', start_at: '2026-10-06T09:00:00Z' }),
        booking({ id: 'in-exp', status: 'booked', start_at: '2026-10-06T14:20:00Z' }),
        booking({ id: 'out-ready', status: 'ready', end_at: '2026-10-06T12:30:00Z', location_code: 'R1-E1', location_area: 'hall' }),
        booking({
          id: 'out-open',
          status: 'stored',
          end_at: '2026-10-06T15:00:00Z',
          open_task_count: 1,
          payment_status: 'open',
          task_chips: [{ title: 'Laden', status: 'open', type: 'charge', is_default: false }],
        }),
        booking({ id: 'cancelled', status: 'cancelled', start_at: '2026-10-06T08:00:00Z' }),
      ],
      [],
      slots,
      range,
      now,
    )
    expect(data.events.map((e) => [e.bookingId, e.kind, e.state])).toEqual([
      ['in-done', 'in', 'done'],
      ['in-late', 'in', 'overdue'],
      ['out-ready', 'out', 'ready'],
      ['in-exp', 'in', 'expected'],
      ['out-open', 'out', 'open'],
    ])
    expect(data.events[1].stateLabel).toBe('überfällig')
    expect(data.events[4].stateLabel).toBe('1 offen')
    expect(data.events[4].unpaid).toBe(true)
    expect(data.kpis).toMatchObject({ arrivals: 3, arrivalsHall: 3, pickups: 2, pickupsHall: 1 })
    expect(data.capacity[0]).toEqual({ label: 'Halle (Premium)', used: 1, total: 2 })
  })

  it('meldet offene Leistungen vor Abholung, Umsetzen, überfällige Anreisen und offene Zahlungen', () => {
    const data = buildToday(
      [
        booking({ id: 'soon', end_at: '2026-10-06T12:00:00Z', open_task_count: 1, task_chips: [{ title: 'Laden', status: 'open', type: 'charge', is_default: false }] }),
        booking({ id: 'tomorrow', end_at: '2026-10-07T05:45:00Z', open_task_count: 1, task_chips: [{ title: 'Aufbereitung', status: 'in_progress', type: 'service', is_default: true }] }),
        booking({ id: 'missed', status: 'booked', start_at: '2026-10-05T08:00:00Z' }),
        booking({ id: 'unpaid', status: 'ready', end_at: '2026-10-06T16:00:00Z', payment_status: 'partial' }),
      ],
      [
        { id: 't1', type: 'relocate', status: 'open', title: 'M-T 9 vor M-T 8 umsetzen', location_code: 'R5-E2', due_at: '2026-10-08T06:00:00Z', plate: 'M-T 9' } as BoardTask,
        { id: 't2', type: 'charge', status: 'open', due_at: '2026-10-06T11:00:00Z' } as BoardTask,
        { id: 't3', type: 'service', status: 'done', due_at: null } as BoardTask,
      ],
      slots,
      range,
      now,
    )
    const titles = data.alerts.map((a) => [a.tone, a.title])
    expect(titles).toEqual([
      ['danger', expect.stringMatching(/ · Abholung 14:00$/)],
      ['danger', 'Regal R5 · Umsetzen'],
      ['warn', expect.stringMatching(/Abholung morgen 07:45$/)],
      ['warn', expect.stringMatching(/Anreise 05\.10\. 10:00$/)],
      ['warn', expect.stringMatching(/Zahlung offen$/)],
    ])
    expect(data.kpis).toMatchObject({ openTasks: 1, dueToday: 1, relocate: 1, relocateText: 'Regal R5, bis 08.10.' })
  })
})

describe('periodRange', () => {
  afterEach(() => vi.useRealTimers())

  it('wählt Tag und Woche (Montag bis Sonntag, Europe/Berlin)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z')) // Donnerstag 08.10.2026, 12:00 Uhr

    expect(periodRange({ view: 'tag', offset: 0 })).toMatchObject({
      from: '2026-10-07T22:00:00.000Z',
      to: '2026-10-08T22:00:00.000Z',
      periodWord: 'heute',
      multiDay: false,
    })
    expect(periodRange({ view: 'tag', offset: 1 })).toMatchObject({ from: '2026-10-08T22:00:00.000Z', to: '2026-10-09T22:00:00.000Z', periodWord: 'morgen' })
    expect(periodRange({ view: 'woche', offset: 0 })).toMatchObject({ from: '2026-10-04T22:00:00.000Z', to: '2026-10-11T22:00:00.000Z', multiDay: true })
    expect(periodRange({ view: 'woche', offset: 1 })).toMatchObject({ from: '2026-10-11T22:00:00.000Z', to: '2026-10-18T22:00:00.000Z' })
  })
})
