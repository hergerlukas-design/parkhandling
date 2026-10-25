import type { BookingStatus, ParkingType } from '../types/domain'
import { berlinDayStart } from './bookings'
import { formatTime } from './format'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export type TransportDirection = 'to_airport' | 'from_airport'
export type TransportType = 'shuttle_slot' | 'premium_on_demand' | 'pickup_delivery'
export type TransportStatus = 'planned' | 'assigned' | 'underway' | 'done' | 'cancelled'

export const DIRECTION_LABEL: Record<TransportDirection, string> = {
  to_airport: 'Zum Flughafen',
  from_airport: 'Vom Flughafen',
}

/** Route für die Fahreransicht */
export const DIRECTION_ROUTE: Record<TransportDirection, string> = {
  to_airport: 'Parkplatz → Terminal',
  from_airport: 'Terminal → Parkplatz',
}

export const TRANSPORT_TYPE_LABEL: Record<TransportType, string> = {
  shuttle_slot: 'Shuttle',
  premium_on_demand: 'Auf Abruf',
  pickup_delivery: 'Hol- & Bring',
}

/** Hol- & Bringservice: Auto wird am Terminal übernommen bzw. übergeben, ein Auftrag je Fahrzeug */
export function isValet(job: Pick<TransportJob, 'type'>): boolean {
  return job.type === 'pickup_delivery'
}

/** Bezeichnung einer Fahrt: Shuttle nach Richtung, Hol- & Bring nach Übernahme/Rückgabe */
export function tripLabel(job: Pick<TransportJob, 'type' | 'direction'>): string {
  if (isValet(job)) return job.direction === 'from_airport' ? 'Übernahme am Terminal' : 'Rückgabe am Terminal'
  return DIRECTION_LABEL[job.direction]
}

/** Route für die Fahreransicht */
export function routeLabel(job: Pick<TransportJob, 'type' | 'direction'>): string {
  if (isValet(job)) return job.direction === 'from_airport' ? 'Terminal: Auto übernehmen → Platz' : 'Platz → Terminal: Auto übergeben'
  return DIRECTION_ROUTE[job.direction]
}

export const TRANSPORT_STATUS_LABEL: Record<TransportStatus, string> = {
  planned: 'geplant',
  assigned: 'Fahrer eingeteilt',
  underway: 'unterwegs',
  done: 'erledigt',
  cancelled: 'abgesagt',
}

export interface TransportPassenger {
  id: string
  booking_id: string
  persons: number
  manual: boolean
  plate: string
  vehicle_model: string | null
  customer_name: string
  customer_phone: string | null
  customer_language: string | null
  flight: string | null
  /** Terminal aus der Flugnummer (settings.airport_terminal_map) */
  terminal: string | null
  start_at: string
  return_flight_at: string | null
  end_at: string
  parking_type: ParkingType
  booking_status: BookingStatus
}

export interface TransportJob {
  id: string
  type: TransportType
  direction: TransportDirection
  scheduled_at: string
  status: TransportStatus
  driver_id: string | null
  driver_name: string | null
  meeting_point: string | null
  note: string | null
  persons: number
  capacity: number
  passengers: TransportPassenger[]
  /** Hol- & Bring: Shuttle, mit dem der Fahrer zum Terminal bzw. zurück fährt */
  driver_shuttle_at?: string | null
}

export interface BookingTrip {
  passenger_id: string
  job_id: string
  type: TransportType
  direction: TransportDirection
  scheduled_at: string
  status: TransportStatus
  persons: number
  manual: boolean
}

export interface Driver {
  id: string
  display_name: string
}

export type CapacityState = 'ok' | 'full' | 'over'

/** Auslastung einer Fahrt: über Kapazität = Warnung, genau voll = Hinweis */
export function capacityState(job: Pick<TransportJob, 'persons' | 'capacity'>): CapacityState {
  if (job.persons > job.capacity) return 'over'
  if (job.persons === job.capacity) return 'full'
  return 'ok'
}

/** Nächster Schritt für die Fahrt (Button im Auftrag) */
export function nextStatus(status: TransportStatus): { to: TransportStatus; label: string } | null {
  if (status === 'planned' || status === 'assigned') return { to: 'underway', label: 'Losfahren' }
  if (status === 'underway') return { to: 'done', label: 'Erledigt' }
  return null
}

/** Hol- & Bring: wie der Fahrer zum Terminal kommt bzw. zurückfährt */
export function driverShuttleHint(job: Pick<TransportJob, 'type' | 'direction' | 'driver_shuttle_at'>): string | null {
  if (!isValet(job)) return null
  const hin = job.direction === 'from_airport'
  if (!job.driver_shuttle_at) return hin ? 'Fahrer: kein Shuttle zum Terminal – selbst organisieren' : 'Fahrer: kein Shuttle zurück – selbst organisieren'
  return hin ? `Fahrer hin mit Shuttle ${formatTime(job.driver_shuttle_at)}` : `Fahrer zurück mit Shuttle ${formatTime(job.driver_shuttle_at)}`
}

/** Treffpunkt einer Hol- & Bring-Fahrt: Terminal des Gasts */
export function meetingTerminal(job: Pick<TransportJob, 'passengers'>): string | null {
  return job.passengers.find((p) => p.terminal)?.terminal ?? null
}

/** Wartezeit des Kunden am Terminal nach der Landung (Rückfahrt), in Minuten */
export function waitAfterLanding(job: Pick<TransportJob, 'scheduled_at' | 'direction' | 'type'>, p: Pick<TransportPassenger, 'return_flight_at'>): number | null {
  const returnTrip = isValet(job) ? job.direction === 'to_airport' : job.direction === 'from_airport'
  if (!returnTrip || !p.return_flight_at) return null
  return Math.round((Date.parse(job.scheduled_at) - Date.parse(p.return_flight_at)) / 60000)
}

/** Zeitangabe je Fahrgast: Ankunft am Platz (hin) bzw. Landung (zurück) */
export function passengerTimeHint(job: Pick<TransportJob, 'direction' | 'type'>, p: TransportPassenger): string {
  if (isValet(job) && job.direction === 'from_airport') return `Übergabe ${formatTime(p.start_at)}`
  if (!isValet(job) && job.direction === 'to_airport') return `Ankunft Platz ${formatTime(p.start_at)}`
  return p.return_flight_at ? `Landung ${formatTime(p.return_flight_at)}` : `Abholung Platz ${formatTime(p.end_at)}`
}

export interface DispoSummary {
  trips: number
  persons: number
  open: number
  over: number
  unassigned: number
}

export function summarize(jobs: TransportJob[]): DispoSummary {
  const active = jobs.filter((j) => j.status !== 'cancelled' && j.passengers.length > 0)
  return {
    trips: active.length,
    persons: active.reduce((s, j) => s + j.persons, 0),
    open: active.filter((j) => j.status !== 'done').length,
    over: active.filter((j) => !isValet(j) && capacityState(j) === 'over').length,
    unassigned: active.filter((j) => j.status !== 'done' && !j.driver_id).length,
  }
}

/** Fahrten nach Richtung, jeweils nach Uhrzeit */
export function splitByDirection(jobs: TransportJob[]): Record<TransportDirection, TransportJob[]> {
  const sorted = [...jobs].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  return {
    to_airport: sorted.filter((j) => j.direction === 'to_airport'),
    from_airport: sorted.filter((j) => j.direction === 'from_airport'),
  }
}

/** Fahreransicht: offene Fahrten zuerst nach Uhrzeit, erledigte am Ende; mit Fahrer: eigene und noch nicht eingeteilte */
export function driverOrder(jobs: TransportJob[], onlyDriver?: string | null): TransportJob[] {
  return jobs
    .filter((j) => j.status !== 'cancelled' && j.passengers.length > 0)
    .filter((j) => !onlyDriver || j.driver_id === onlyDriver || !j.driver_id)
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || a.scheduled_at.localeCompare(b.scheduled_at))
}

/** Ziel-Fahrten zum Umsetzen: gleiche Richtung und Art, noch offen, nicht die aktuelle */
export function moveTargets(jobs: TransportJob[], current: TransportJob): TransportJob[] {
  // Hol- & Bring: ein Auftrag je Fahrzeug, nur die Uhrzeit lässt sich ändern
  if (isValet(current)) return []
  return jobs
    .filter((j) => j.id !== current.id && j.direction === current.direction && isValet(j) === isValet(current))
    .filter((j) => j.status === 'planned' || j.status === 'assigned')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
}

/** Tag [from, to) in Europe/Berlin, Versatz in Tagen ab heute */
export function dayRange(offset: number): { from: string; to: string } {
  return { from: berlinDayStart(offset), to: berlinDayStart(offset + 1) }
}

export async function loadTransportBoard(from: string, to: string): Promise<TransportJob[]> {
  const { data, error } = await db().rpc('transport_board', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  return (data ?? []) as TransportJob[]
}

export async function loadBookingTrips(bookingId: string): Promise<BookingTrip[]> {
  const { data, error } = await db().rpc('booking_transport', { p_booking_id: bookingId })
  if (error) throw new Error(error.message)
  return (data ?? []) as BookingTrip[]
}

export async function listDrivers(): Promise<Driver[]> {
  const { data, error } = await db().rpc('list_drivers')
  if (error) throw new Error(error.message)
  return (data ?? []) as Driver[]
}

export async function setJobStatus(id: string, status: TransportStatus, driverId?: string | null): Promise<void> {
  const patch: { status: TransportStatus; driver_id?: string } = { status }
  if (driverId) patch.driver_id = driverId
  const { error } = await db().from('transport_jobs').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Fahrer einteilen; geplante Fahrt wird dabei „eingeteilt“, ohne Fahrer wieder „geplant“ */
export async function setJobDriver(job: Pick<TransportJob, 'id' | 'status'>, driverId: string | null): Promise<void> {
  const patch: { driver_id: string | null; status?: TransportStatus } = { driver_id: driverId }
  if (driverId && job.status === 'planned') patch.status = 'assigned'
  if (!driverId && job.status === 'assigned') patch.status = 'planned'
  const { error } = await db().from('transport_jobs').update(patch).eq('id', job.id)
  if (error) throw new Error(error.message)
}

export async function setJobNote(id: string, note: string): Promise<void> {
  const { error } = await db().from('transport_jobs').update({ note: note.trim() || null }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Fahrgast in andere Fahrt (jobId) oder neuen Auftrag auf Abruf (at) umsetzen */
export async function movePassenger(passengerId: string, target: { jobId: string } | { at: string }): Promise<void> {
  const args = 'jobId' in target
    ? { p_passenger_id: passengerId, p_job_id: target.jobId }
    : { p_passenger_id: passengerId, p_at: target.at }
  const { error } = await db().rpc('move_transport_passenger', args)
  if (error) throw new Error(error.message)
}

/** Umsetzung zurücknehmen, Automatik plant wieder */
export async function resetPassenger(passengerId: string): Promise<void> {
  const { error } = await db().rpc('reset_transport_passenger', { p_passenger_id: passengerId })
  if (error) throw new Error(error.message)
}

/** Realtime nur auf transport_jobs (Abschnitt 11.5); Fahrgast-Änderungen laufen über die Fahrten mit */
export function subscribeTransport(onChange: () => void): () => void {
  if (!supabase) return () => undefined
  const channel = supabase
    .channel('shuttle')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_jobs' }, () => onChange())
    .subscribe()
  return () => void supabase?.removeChannel(channel)
}
