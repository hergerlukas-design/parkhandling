import type { ParkingType, ReturnMode } from '../types/domain'

/**
 * Normalisierte Buchung – einziges Format, das die App vom Buchungsportal kennt.
 * Entspricht dem JSON-Parameter von `upsert_booking`. Fehlende optionale Felder
 * werden bei Umbuchungen nicht überschrieben.
 */
export interface BookingInput {
  external_ref?: string | null
  customer_name: string
  customer_email?: string | null
  customer_phone?: string | null
  plate: string
  vehicle_model?: string | null
  persons?: number | null
  /** ISO 8601 mit Zeitzone */
  start_at: string
  end_at: string
  parking_type: ParkingType
  return_mode?: ReturnMode | null
  notes?: string | null
  /** Leistungscodes (services.code); Grundreinigung wird automatisch gebucht */
  services?: string[]
  cancelled?: boolean
}

export type NormalizeResult =
  | { ok: true; booking: BookingInput; warnings: string[] }
  | { ok: false; errors: string[] }

/**
 * Adapter je Buchungsquelle (manuell, CSV/Excel, später Webhook/API eines Portals).
 * Neue Portale = neuer Adapter, keine Änderungen außerhalb dieses Ordners.
 */
export interface BookingAdapter<Raw> {
  /** Wert für bookings.source – Teil des Idempotenz-Schlüssels (source, external_ref) */
  readonly source: string
  normalize(raw: Raw): NormalizeResult
}
