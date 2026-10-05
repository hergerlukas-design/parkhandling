/**
 * Domänentypen passend zu supabase/migrations. Bei Schemaänderungen mitpflegen
 * (oder später per `supabase gen types typescript` ersetzen).
 */

export type ParkingType = 'indoor' | 'outdoor_cover' | 'outdoor'
export type ReturnMode = 'shuttle' | 'vallet' | 'pickup_delivery' | 'self'
export type PaymentStatus = 'open' | 'partial' | 'paid' | 'refunded'
export type FuelType = 'combustion' | 'electric' | 'hybrid'
export type Role = 'admin' | 'staff'
export type BookingStatus =
  | 'booked'
  | 'arrived'
  | 'stored'
  | 'in_service'
  | 'ready'
  | 'in_transit'
  | 'completed'
  | 'cancelled'
export type TaskType = 'service' | 'charge' | 'fuel' | 'relocate'
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'
export type LocationArea = 'hall' | 'outdoor_a' | 'outdoor_b' | 'work' | 'buffer' | 'transit'
export type LocationStatus = 'free' | 'occupied' | 'reserved' | 'blocked'
export type MediaOwnerType = 'task' | 'protocol' | 'damage'
export type MediaKind = 'photo' | 'signature' | 'pdf'
export type MediaProvider = 'supabase' | 'r2'
export type ProtocolType = 'intake' | 'handover'
export type TransportType = 'shuttle_slot' | 'premium_on_demand' | 'vallet'
export type TransportDirection = 'to_airport' | 'from_airport'

interface Row {
  id: string
  created_at: string
  updated_at: string
}

export interface Booking extends Row {
  source: string
  external_ref: string | null
  received_at: string | null
  customer_name: string
  company: string | null
  customer_email: string | null
  customer_phone: string | null
  plate: string
  plate_normalized: string
  vehicle_model: string | null
  fuel_type: FuelType | null
  persons: number
  start_at: string
  end_at: string
  parking_type: ParkingType
  return_mode: ReturnMode
  status: BookingStatus
  current_location_id: string | null
  price_total: number | null
  payment_status: PaymentStatus
  portal_token: string
  notes: string | null
}

export interface Service extends Row {
  code: string
  name: string
  description: string | null
  category: string
  price: number | null
  steps: string[]
  active: boolean
  is_default: boolean
  sort_order: number
}

export interface BookingService extends Row {
  booking_id: string
  service_id: string
  price_at_booking: number | null
  description: string | null
  status: 'active' | 'cancelled'
  cancelled_at: string | null
}

export interface Task extends Row {
  booking_id: string
  type: TaskType
  service_id: string | null
  booking_service_id: string | null
  status: TaskStatus
  title: string | null
  checklist: ChecklistItem[]
  due_at: string | null
  done_by: string | null
  done_at: string | null
  note: string | null
}

export interface ChecklistItem {
  label: string
  done: boolean
}

export interface KeySlot extends Row {
  booking_id: string | null
  key_code: string
  storage_place: string | null
  qr_code: string | null
}

export interface Location extends Row {
  code: string
  name: string | null
  area: LocationArea
  rack: number | null
  rack_column: number | null
  level: 1 | 2 | 3 | null
  row: string | null
  number: number | null
  has_cover: boolean
  capacity: number
  status: LocationStatus
  qr_code: string | null
  active: boolean
  sort_order: number
}

export interface Media extends Row {
  booking_id: string | null
  owner_type: MediaOwnerType
  owner_id: string | null
  kind: MediaKind
  provider: MediaProvider
  bucket: string
  path: string
  thumb_path: string | null
  width: number | null
  height: number | null
  bytes: number
  taken_at: string | null
  retention_until: string | null
  archived_at: string | null
}

export interface VehicleMovement extends Row {
  booking_id: string
  from_location_id: string | null
  to_location_id: string | null
  moved_by: string | null
  moved_at: string
  reason: string | null
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: 'Gebucht',
  arrived: 'Angekommen',
  stored: 'Eingelagert',
  in_service: 'In Arbeit',
  ready: 'Bereit',
  in_transit: 'Unterwegs',
  completed: 'Abgeschlossen',
  cancelled: 'Storniert',
}

export const PARKING_TYPE_LABEL: Record<ParkingType, string> = {
  indoor: 'Halle',
  outdoor_cover: 'Außen mit Plane',
  outdoor: 'Außen',
}

export const AREA_LABEL: Record<LocationArea, string> = {
  hall: 'Halle',
  outdoor_a: 'Außen A',
  outdoor_b: 'Außen B',
  work: 'Arbeitsplatz',
  buffer: 'Puffer',
  transit: 'Unterwegs',
}

export const RETURN_MODE_LABEL: Record<ReturnMode, string> = {
  shuttle: 'Shuttle',
  vallet: 'Vallet',
  pickup_delivery: 'Hol- & Bringservice',
  self: 'Selbst',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  open: 'Offen',
  partial: 'Teilweise',
  paid: 'Bezahlt',
  refunded: 'Erstattet',
}

export const FUEL_TYPE_LABEL: Record<FuelType, string> = {
  combustion: 'Verbrenner',
  electric: 'Elektro',
  hybrid: 'Hybrid',
}
