import { berlinDayStart, type BookingListItem } from './bookings'
import { formatDate, formatTime } from './format'
import { loadBoard, type BoardSlot } from './siteplan'
import { loadTaskBoard, type BoardTask } from './tasks'
import { supabase } from './supabase'
import { PARKING_TYPE_LABEL, RETURN_MODE_LABEL } from '../types/domain'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export type EventState = 'done' | 'ready' | 'open' | 'expected' | 'overdue'

export interface DayEvent {
  bookingId: string
  at: string
  kind: 'in' | 'out'
  plate: string
  model: string | null
  info: string
  state: EventState
  stateLabel: string
  unpaid: boolean
}

export interface Alert {
  tone: 'danger' | 'warn'
  title: string
  text: string
  href: string
}

export interface Capacity {
  label: string
  used: number
  total: number
}

export interface TodayData {
  kpis: { arrivals: number; arrivalsHall: number; pickups: number; pickupsHall: number; openTasks: number; dueToday: number; relocate: number; relocateText: string }
  events: DayEvent[]
  alerts: Alert[]
  capacity: Capacity[]
}

const ACTIVE = ['booked', 'arrived', 'stored', 'in_service', 'ready', 'in_transit']
const ON_SITE = ['arrived', 'stored', 'in_service', 'ready', 'in_transit']

function openTitles(b: BookingListItem): string[] {
  return b.task_chips.filter((c) => c.status !== 'done').map((c) => c.title ?? 'Leistung')
}

/** Tagesansicht aus Buchungen (heute an/ab, morgen ab, überfällig), Aufgaben und Lageplan. */
export function buildToday(
  bookings: BookingListItem[],
  tasks: BoardTask[],
  slots: BoardSlot[],
  range: { today: string; tomorrow: string; dayAfter: string },
  now: Date = new Date(),
): TodayData {
  const inDay = (iso: string, from: string, to: string) => iso >= from && iso < to
  const live = bookings.filter((b) => b.status !== 'cancelled')
  const arrivals = live.filter((b) => inDay(b.start_at, range.today, range.tomorrow))
  const pickups = live.filter((b) => inDay(b.end_at, range.today, range.tomorrow))
  const nowIso = now.toISOString()

  const events: DayEvent[] = []
  for (const b of arrivals) {
    const arrived = ON_SITE.includes(b.status) || b.status === 'completed'
    const late = !arrived && b.start_at < new Date(now.getTime() - 30 * 60000).toISOString()
    events.push({
      bookingId: b.id,
      at: b.start_at,
      kind: 'in',
      plate: b.plate,
      model: b.vehicle_model,
      info: arrived
        ? [RETURN_MODE_LABEL[b.return_mode], b.location_code ? `eingelagert ${b.location_code}` : 'angekommen, noch nicht eingelagert'].join(' · ')
        : [RETURN_MODE_LABEL[b.return_mode], PARKING_TYPE_LABEL[b.parking_type], openTitles(b).join(', ')].filter(Boolean).join(' · '),
      state: arrived ? 'done' : late ? 'overdue' : 'expected',
      stateLabel: arrived ? 'erledigt' : late ? 'überfällig' : 'erwartet',
      unpaid: false,
    })
  }
  for (const b of pickups) {
    const open = b.open_task_count
    const done = b.status === 'completed'
    events.push({
      bookingId: b.id,
      at: b.end_at,
      kind: 'out',
      plate: b.plate,
      model: b.vehicle_model,
      info: [
        RETURN_MODE_LABEL[b.return_mode],
        b.location_code ?? (done ? 'übergeben' : b.status === 'booked' ? 'noch nicht angekommen' : null),
        !done && open ? `${openTitles(b).join(', ')} offen` : null,
      ].filter(Boolean).join(' · '),
      state: done ? 'done' : open ? 'open' : 'ready',
      stateLabel: done ? 'erledigt' : open ? `${open} offen` : 'bereit',
      unpaid: !done && (b.payment_status === 'open' || b.payment_status === 'partial'),
    })
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind))

  const alerts: Alert[] = []
  // Abholung heute/morgen mit offenen Leistungen
  for (const b of live.filter((x) => ACTIVE.includes(x.status) && x.open_task_count > 0 && inDay(x.end_at, range.today, range.dayAfter))) {
    const today = b.end_at < range.tomorrow
    alerts.push({
      tone: today && b.end_at < new Date(now.getTime() + 3 * 3600000).toISOString() ? 'danger' : 'warn',
      title: `${b.plate} · Abholung ${today ? '' : 'morgen '}${formatTime(b.end_at)}`,
      text: `${openTitles(b).join(', ')} noch offen${today ? '' : ' – vor Schichtende erledigen'}.`,
      href: `/fahrzeuge/${b.id}`,
    })
  }
  // Umsetz-Aufgaben (Regal-Konflikte)
  const relocate = tasks.filter((t) => t.type === 'relocate' && t.status !== 'done')
  for (const t of relocate) {
    alerts.push({
      tone: 'danger',
      title: `${t.location_code ? `Regal ${t.location_code.split('-')[0]}` : t.plate} · Umsetzen`,
      text: `${t.title ?? 'Reihenfolge im Regal passt nicht'}${t.due_at ? ` – bis ${formatDate(t.due_at).slice(0, 6)} ${formatTime(t.due_at)}` : ''}.`,
      href: t.location_code ? `/lageplan?platz=${encodeURIComponent(t.location_code)}` : '/aufgaben',
    })
  }
  // Ankünfte überfällig (gestern oder früher und nicht angekommen)
  for (const b of live.filter((x) => x.status === 'booked' && x.start_at < range.today)) {
    alerts.push({
      tone: 'warn',
      title: `${b.plate} · Anreise ${formatDate(b.start_at).slice(0, 6)} ${formatTime(b.start_at)}`,
      text: 'Noch nicht angekommen – Buchung prüfen.',
      href: `/fahrzeuge/${b.id}`,
    })
  }
  // Zahlung offen bei Abholung heute
  for (const e of events.filter((x) => x.kind === 'out' && x.unpaid && x.at >= nowIso)) {
    alerts.push({ tone: 'warn', title: `${e.plate} · Zahlung offen`, text: `Abholung ${formatTime(e.at)} – Zahlung vor Übergabe klären.`, href: `/fahrzeuge/${e.bookingId}` })
  }
  alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1))

  const openTasks = tasks.filter((t) => t.status !== 'done' && t.type !== 'relocate')
  const capacity = (
    [
      ['Halle (Premium)', (s: BoardSlot) => s.area === 'hall'],
      ['Außen A · mit Plane', (s: BoardSlot) => s.area === 'outdoor_a'],
      ['Außen B · ohne Plane', (s: BoardSlot) => s.area === 'outdoor_b'],
    ] as const
  ).map(([label, match]) => {
    const area = slots.filter(match)
    return { label, used: area.filter((s) => s.booking_id).length, total: area.length }
  })

  const firstRelocate = relocate[0]
  return {
    kpis: {
      arrivals: arrivals.length,
      arrivalsHall: arrivals.filter((b) => b.parking_type === 'indoor').length,
      pickups: pickups.length,
      pickupsHall: pickups.filter((b) => b.location_area === 'hall').length,
      openTasks: openTasks.length,
      dueToday: openTasks.filter((t) => t.due_at && t.due_at < range.tomorrow).length,
      relocate: relocate.length,
      relocateText: firstRelocate
        ? `${firstRelocate.location_code ? `Regal ${firstRelocate.location_code.split('-')[0]}` : firstRelocate.plate}${firstRelocate.due_at ? `, bis ${formatDate(firstRelocate.due_at).slice(0, 6)}` : ''}`
        : 'keine Konflikte',
    },
    events,
    alerts,
    capacity,
  }
}

export async function loadToday(): Promise<TodayData> {
  const range = { today: berlinDayStart(0), tomorrow: berlinDayStart(1), dayAfter: berlinDayStart(2) }
  const weekAgo = berlinDayStart(-7)
  const [day, overdue, tasks, slots] = await Promise.all([
    db()
      .from('booking_list')
      .select('*')
      .or(
        `and(start_at.gte.${range.today},start_at.lt.${range.tomorrow}),and(end_at.gte.${range.today},end_at.lt.${range.dayAfter})`,
      )
      .neq('status', 'cancelled')
      .limit(500),
    db()
      .from('booking_list')
      .select('*')
      .eq('status', 'booked')
      .gte('start_at', weekAgo)
      .lt('start_at', range.today)
      .limit(100),
    loadTaskBoard(),
    loadBoard(),
  ])
  const failed = [day, overdue].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const bookings = [...(day.data ?? []), ...(overdue.data ?? [])] as BookingListItem[]
  return buildToday(bookings, tasks, slots, range)
}
