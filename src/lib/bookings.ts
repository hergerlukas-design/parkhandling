import type { BookingInput } from '../booking-adapters'
import type { Booking, BookingService, BookingStatus, PaymentStatus, Service, Task } from '../types/domain'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export interface UpsertResult {
  id: string
  action: 'created' | 'updated' | 'unchanged'
  unknown_services: string[]
}

/** Einziger Schreibweg für Buchungen aus Adaptern (idempotent über source + external_ref). */
export async function upsertBooking(input: BookingInput, source: string): Promise<UpsertResult> {
  const { data, error } = await db().rpc('upsert_booking', { p_booking: input, p_source: source })
  if (error) throw new Error(error.message)
  return data as UpsertResult
}

/** Filter-Chips der Fahrzeugliste (wie im Klick-Prototyp) */
export type ListChip = 'all' | 'hall' | 'outdoor' | 'pickup_today' | 'open_services' | 'charge_fuel' | 'cancelled'

export const LIST_CHIPS: [ListChip, string][] = [
  ['all', 'Alle'],
  ['hall', 'Halle'],
  ['outdoor', 'Außen'],
  ['pickup_today', 'Heute raus'],
  ['open_services', 'Offene Leistungen'],
  ['charge_fuel', 'Laden/Tanken'],
  ['cancelled', 'Storniert'],
]

export interface BookingFilter {
  search?: string
  chip?: ListChip
  status?: BookingStatus | ''
  paymentStatus?: PaymentStatus | ''
}

export interface BookingCursor {
  end_at: string
  id: string
}

export interface TaskChip {
  title: string | null
  status: Task['status']
  type: Task['type']
  is_default: boolean
}

export type BookingListItem = Booking & {
  location_code: string | null
  location_area: string | null
  location_level: number | null
  open_task_count: number
  open_charge_fuel_count: number
  task_chips: TaskChip[]
}

const PAGE_SIZE = 50

/** Beginn eines Tages in Europe/Berlin (offset Tage ab heute) als ISO. */
export function berlinDayStart(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86400000))
  const probe = new Date(`${parts}T12:00:00Z`)
  const berlinNoon = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(probe)
  const offsetHours = Number(berlinNoon) - 12
  return new Date(Date.parse(`${parts}T00:00:00Z`) - offsetHours * 3600000).toISOString()
}

// PostgREST-Builder generisch halten, damit Liste und Zähler dieselben Filter nutzen
type Query = any

function applyChip(q: Query, chip: ListChip): Query {
  if (chip === 'cancelled') return q.eq('status', 'cancelled')
  q = q.not('status', 'in', '(completed,cancelled)')
  switch (chip) {
    case 'hall':
      return q.eq('parking_type', 'indoor')
    case 'outdoor':
      return q.in('parking_type', ['outdoor', 'outdoor_cover'])
    case 'pickup_today':
      return q.lt('end_at', berlinDayStart(1))
    case 'open_services':
      return q.gt('open_task_count', 0)
    case 'charge_fuel':
      return q.gt('open_charge_fuel_count', 0)
    default:
      return q
  }
}

function applySearch(q: Query, search?: string): Query {
  const text = search?.trim()
  if (!text) return q
  const plate = text.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '')
  const safe = text.replace(/[%,()"]/g, ' ')
  return plate
    ? q.or(`plate_normalized.like.${plate}%,customer_name.ilike.%${safe}%,company.ilike.%${safe}%,external_ref.ilike.${safe}%`)
    : q.ilike('customer_name', `%${safe}%`)
}

/**
 * Keyset-Paginierung nach (end_at, id) – kein OFFSET, damit die Liste auch bei vielen
 * Buchungen schnell bleibt.
 */
export async function listBookings(
  filter: BookingFilter,
  cursor?: BookingCursor | null,
): Promise<{ items: BookingListItem[]; next: BookingCursor | null }> {
  let q: Query = db()
    .from('booking_list')
    .select('*')
    .order('end_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PAGE_SIZE)
  q = applyChip(q, filter.chip ?? 'all')
  q = applySearch(q, filter.search)
  if (filter.status) q = q.eq('status', filter.status)
  if (filter.paymentStatus) q = q.eq('payment_status', filter.paymentStatus)
  if (cursor) {
    q = q.or(`end_at.gt."${cursor.end_at}",and(end_at.eq."${cursor.end_at}",id.gt.${cursor.id})`)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  const items = (data ?? []) as BookingListItem[]
  const last = items.at(-1)
  return { items, next: items.length === PAGE_SIZE && last ? { end_at: last.end_at, id: last.id } : null }
}

/** Anzahl je Filter-Chip (für die Zahlen in den Chips), unter Berücksichtigung der Suche. */
export async function countByChip(search?: string): Promise<Record<ListChip, number>> {
  const entries = await Promise.all(
    LIST_CHIPS.map(async ([chip]) => {
      let q: Query = db().from('booking_list').select('id', { count: 'exact', head: true })
      q = applySearch(applyChip(q, chip), search)
      const { count, error } = await q
      if (error) throw new Error(error.message)
      return [chip, count ?? 0] as const
    }),
  )
  return Object.fromEntries(entries) as Record<ListChip, number>
}

export interface BookingDetail {
  booking: Booking & { location: { code: string; area: string } | null }
  services: (BookingService & { service: Pick<Service, 'code' | 'name' | 'category' | 'is_default'> })[]
  tasks: Task[]
  history: { id: string; changed_fields: Record<string, unknown>; source: string; changed_at: string }[]
  movements: {
    id: string
    moved_at: string
    reason: string | null
    from: { code: string } | null
    to: { code: string } | null
  }[]
}

export async function getBookingDetail(id: string): Promise<BookingDetail> {
  const client = db()
  const [booking, services, tasks, history, movements] = await Promise.all([
    client
      .from('bookings')
      .select('*, location:locations!bookings_current_location_id_fkey(code, area)')
      .eq('id', id)
      .single(),
    client
      .from('booking_services')
      .select('*, service:services(code, name, category, is_default)')
      .eq('booking_id', id)
      .order('created_at'),
    client.from('tasks').select('*').eq('booking_id', id).order('created_at'),
    client
      .from('booking_history')
      .select('id, changed_fields, source, changed_at')
      .eq('booking_id', id)
      .order('changed_at', { ascending: false })
      .limit(100),
    client
      .from('vehicle_movements')
      .select(
        'id, moved_at, reason, from:locations!vehicle_movements_from_location_id_fkey(code), to:locations!vehicle_movements_to_location_id_fkey(code)',
      )
      .eq('booking_id', id)
      .order('moved_at', { ascending: false })
      .limit(100),
  ])
  const failed = [booking, services, tasks, history, movements].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  return {
    booking: booking.data as BookingDetail['booking'],
    services: (services.data ?? []) as BookingDetail['services'],
    tasks: (tasks.data ?? []) as Task[],
    history: (history.data ?? []) as BookingDetail['history'],
    movements: (movements.data ?? []) as unknown as BookingDetail['movements'],
  }
}

export async function listActiveServices(): Promise<Service[]> {
  const { data, error } = await db()
    .from('services')
    .select('*')
    .eq('active', true)
    .order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as Service[]
}

/** Stornieren statt löschen (Status „storniert“, offene Aufgaben werden per Trigger storniert). */
export async function cancelBooking(id: string): Promise<void> {
  const { error } = await db().rpc('upsert_booking', { p_booking: { id, cancelled: true }, p_source: 'manual' })
  if (error) throw new Error(error.message)
}
