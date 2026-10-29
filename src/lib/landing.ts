import { emptyManualForm, type ManualBookingForm } from '../booking-adapters'
import type { ParkingType } from '../types/domain'
import { formatDate } from './format'
import { supabase } from './supabase'

/**
 * Daten der Landingpage in der App: Anfragen (`inquiries`), Tarife der Online-Buchung
 * (`booking_tariffs`) und Online-Widerrufe (`booking_withdrawals`).
 */

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export const LANDING_SOURCE = 'landing'

export type InquiryStatus = 'new' | 'contacted' | 'converted' | 'rejected'
export type InquiryService = 'shuttle' | 'detailing' | 'pickup_delivery'

export interface Inquiry {
  id: string
  created_at: string
  arrival_date: string
  pickup_date: string
  parking_type: ParkingType | 'any'
  plate: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  services: InquiryService[]
  message: string | null
  status: InquiryStatus
  converted_booking_id: string | null
  utm_source: string | null
  utm_campaign: string | null
}

export interface Withdrawal {
  id: string
  booking_ref: string
  customer_name: string
  reason: string | null
  received_at: string
  within_period: boolean
}

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  new: 'Neu',
  contacted: 'Kontaktiert',
  converted: 'Übernommen',
  rejected: 'Abgelehnt',
}

export const INQUIRY_SERVICE_LABEL: Record<InquiryService, string> = {
  shuttle: 'Shuttle',
  detailing: 'Aufbereitung',
  pickup_delivery: 'Hol- & Bringservice',
}

export const INQUIRY_PARKING_LABEL: Record<Inquiry['parking_type'], string> = {
  indoor: 'Halle',
  outdoor_cover: 'Außen mit Plane',
  outdoor: 'Außen',
  any: 'egal',
}

/** Offene Anfragen: neu oder kontaktiert */
export const OPEN_INQUIRY_STATUSES: InquiryStatus[] = ['new', 'contacted']

export async function listInquiries(open: boolean): Promise<Inquiry[]> {
  let q = db().from('inquiries').select('*').order('created_at', { ascending: false }).limit(200)
  if (open) q = q.in('status', OPEN_INQUIRY_STATUSES)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Inquiry[]
}

export async function countNewInquiries(): Promise<number> {
  const { count, error } = await db().from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new')
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function setInquiryStatus(id: string, status: InquiryStatus, bookingId?: string): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (bookingId) patch.converted_booking_id = bookingId
  const { error } = await db().from('inquiries').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Buchungsformular aus einer Anfrage vorbelegen (Uhrzeiten fehlen in der Anfrage). */
export function formFromInquiry(i: Inquiry): ManualBookingForm {
  const wishes = [
    i.services.includes('detailing') && 'Aufbereitung gewünscht (Umfang klären)',
    i.message?.trim(),
  ].filter(Boolean)
  return {
    ...emptyManualForm(),
    customer_name: `${i.first_name} ${i.last_name}`.trim(),
    customer_email: i.email,
    customer_phone: i.phone ?? '',
    plate: i.plate,
    start_date: i.arrival_date,
    end_date: i.pickup_date,
    parking_type: i.parking_type === 'any' ? 'outdoor' : i.parking_type,
    return_mode: i.services.includes('pickup_delivery') ? 'pickup_delivery' : i.services.includes('shuttle') ? 'shuttle' : 'self',
    notes: [`Aus Anfrage vom ${formatDate(i.created_at)}`, ...wishes].join('\n'),
  }
}

/** Tarifname zur Buchung (null, wenn die Tabelle fehlt oder kein Tarif gesetzt ist) */
export async function tariffLabel(code: string | null | undefined): Promise<string | null> {
  if (!code) return null
  const { data } = await db().from('booking_tariffs').select('label').eq('code', code).maybeSingle()
  return (data as { label: string } | null)?.label ?? null
}

export async function listWithdrawals(bookingId: string): Promise<Withdrawal[]> {
  const { data, error } = await db()
    .from('booking_withdrawals')
    .select('id, booking_ref, customer_name, reason, received_at, within_period')
    .eq('booking_id', bookingId)
    .order('received_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Withdrawal[]
}
