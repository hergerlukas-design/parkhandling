import { toImportPayload, type ImportFlag, type MailType, type ParkosOptions, type ParkosParseResult, type ParkosProduct } from '../booking-adapters'
import { DEFAULT_RETURN_BUFFER_MINUTES } from '../booking-adapters/manual'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export type ImportStatus = 'imported' | 'updated' | 'unchanged' | 'needs_review' | 'failed' | 'resolved'

export const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = {
  imported: 'Angelegt',
  updated: 'Aktualisiert',
  unchanged: 'Unverändert',
  needs_review: 'Prüfen',
  failed: 'Fehler',
  resolved: 'Erledigt',
}

export const IMPORT_STATUS_STYLE: Record<ImportStatus, string> = {
  imported: 'bg-ok-soft text-ok-ink',
  updated: 'bg-accent-soft text-accent-dark',
  unchanged: 'bg-chip text-subtle',
  needs_review: 'bg-warn-soft text-warn-ink',
  failed: 'bg-danger-soft text-danger-ink',
  resolved: 'bg-chip text-muted',
}

export interface BookingImportRow {
  id: string
  created_at: string
  source: string
  channel: 'manual' | 'imap'
  external_ref: string | null
  mail_type: MailType
  subject: string | null
  sender: string | null
  received_at: string | null
  raw_text: string
  flags: ImportFlag[]
  status: ImportStatus
  error: string | null
  booking_id: string | null
  reviewed_at: string | null
  review_note: string | null
}

export interface ImportResult {
  import_id: string
  status: ImportStatus
  booking_id: string | null
  error: string | null
  unknown_services: string[]
}

/** Parkform-Zuordnung und Puffer aus `settings` (Fallback: Werte aus ANNAHMEN.md). */
export async function loadParkosOptions(): Promise<ParkosOptions> {
  const { data, error } = await db()
    .from('settings')
    .select('key, value')
    .in('key', ['parkos_product_map', 'return_buffer_minutes'])
  if (error) throw new Error(error.message)
  const byKey = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as unknown]))
  const map = Array.isArray(byKey.parkos_product_map) ? (byKey.parkos_product_map as ParkosProduct[]) : []
  const buffer = Number(byKey.return_buffer_minutes)
  return {
    productMap: map.length
      ? map
      : [{ parkos_label: 'Shuttle-Transfer (nicht überdacht)', parking_type: 'outdoor', return_mode: 'shuttle' }],
    bufferMinutes: Number.isFinite(buffer) && buffer >= 0 ? buffer : DEFAULT_RETURN_BUFFER_MINUTES,
  }
}

/** Gleicher Weg wie der spätere IMAP-Abruf: Datenbankfunktion import_booking_mail. */
export async function importParkosMail(result: ParkosParseResult): Promise<ImportResult> {
  const { data, error } = await db().rpc('import_booking_mail', { p: toImportPayload(result, 'manual') })
  if (error) throw new Error(error.message)
  return data as ImportResult
}

export async function listImports(onlyOpen: boolean): Promise<BookingImportRow[]> {
  let q = db()
    .from('booking_imports')
    .select('id, created_at, source, channel, external_ref, mail_type, subject, sender, received_at, raw_text, flags, status, error, booking_id, reviewed_at, review_note')
    .order('created_at', { ascending: false })
    .limit(100)
  if (onlyOpen) q = q.in('status', ['needs_review', 'failed'])
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as BookingImportRow[]
}

/** Anzahl offener Prüf-Einträge (für den Zähler am Button). 0, solange die Tabelle fehlt. */
export async function countOpenImports(): Promise<number> {
  const { count, error } = await db()
    .from('booking_imports')
    .select('id', { count: 'exact', head: true })
    .in('status', ['needs_review', 'failed'])
  if (error) return 0
  return count ?? 0
}

export async function resolveImport(id: string, note: string): Promise<void> {
  const { error } = await db().rpc('resolve_booking_import', { p_id: id, p_note: note || null })
  if (error) throw new Error(error.message)
}
