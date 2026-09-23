import type { BookingInput } from '../booking-adapters'
import type { Booking, BookingService, BookingStatus, ParkingType, Service, Task } from '../types/domain'
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

export type PickupFilter = 'all' | 'today' | 'tomorrow' | 'week' | 'overdue'

export interface BookingFilter {
  search?: string
  statuses?: BookingStatus[]
  parkingType?: ParkingType | ''
  pickup?: PickupFilter
  /** Nur aktive Buchungen (nicht abgeschlossen/storniert) */
  activeOnly?: boolean
}

export interface BookingCursor {
  end_at: string
  id: string
}

export type BookingListItem = Booking & {
  location: { code: string } | null
  open_tasks: { count: number }[]
}

const PAGE_SIZE = 50

/** Beginn eines Tages in Europe/Berlin (offset Tage ab heute) als ISO. */
function berlinDayStart(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86400000))
  // Mitternacht Berlin: über die Offset-Bestimmung im Intl-Format
  const probe = new Date(`${parts}T12:00:00Z`)
  const berlinNoon = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(probe)
  const offsetHours = Number(berlinNoon) - 12
  return new Date(Date.parse(`${parts}T00:00:00Z`) - offsetHours * 3600000).toISOString()
}

/**
 * Keyset-Paginierung nach (end_at, id) – kein OFFSET, damit die Liste auch bei vielen
 * Buchungen schnell bleibt.
 */
export async function listBookings(
  filter: BookingFilter,
  cursor?: BookingCursor | null,
): Promise<{ items: BookingListItem[]; next: BookingCursor | null }> {
  let q = db()
    .from('bookings')
    .select('*, location:locations!bookings_current_location_id_fkey(code), open_tasks:tasks(count)')
    .in('open_tasks.status', ['open', 'in_progress'])
    .neq('open_tasks.type', 'relocate')
    .order('end_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PAGE_SIZE)

  const search = filter.search?.trim()
  if (search) {
    const plate = search.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '')
    const text = search.replace(/[%,()]/g, ' ')
    q = plate
      ? q.or(`plate_normalized.like.${plate}%,customer_name.ilike.%${text}%,external_ref.ilike.${text}%`)
      : q.ilike('customer_name', `%${text}%`)
  }
  if (filter.statuses?.length) q = q.in('status', filter.statuses)
  else if (filter.activeOnly) q = q.not('status', 'in', '(completed,cancelled)')
  if (filter.parkingType) q = q.eq('parking_type', filter.parkingType)

  switch (filter.pickup) {
    case 'today':
      q = q.gte('end_at', berlinDayStart(0)).lt('end_at', berlinDayStart(1))
      break
    case 'tomorrow':
      q = q.gte('end_at', berlinDayStart(1)).lt('end_at', berlinDayStart(2))
      break
    case 'week':
      q = q.gte('end_at', berlinDayStart(0)).lt('end_at', berlinDayStart(7))
      break
    case 'overdue':
      q = q.lt('end_at', new Date().toISOString()).not('status', 'in', '(completed,cancelled)')
      break
  }

  if (cursor) {
    q = q.or(`end_at.gt."${cursor.end_at}",and(end_at.eq."${cursor.end_at}",id.gt.${cursor.id})`)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  const items = (data ?? []) as BookingListItem[]
  const last = items.at(-1)
  return { items, next: items.length === PAGE_SIZE && last ? { end_at: last.end_at, id: last.id } : null }
}

export interface BookingDetail {
  booking: Booking & { location: { code: string; area: string } | null }
  services: (BookingService & { service: Pick<Service, 'code' | 'name' | 'category'> })[]
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
      .select('*, service:services(code, name, category)')
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
