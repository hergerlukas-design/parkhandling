import type { BookingStatus, ChecklistItem, FuelType, Media, Task } from '../types/domain'
import { berlinDayStart } from './bookings'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

/** Aufgabe mit Fahrzeug, Ort und Leistung (View task_board) */
export type BoardTask = Task & {
  related_booking_id: string | null
  started_by: string | null
  started_at: string | null
  plate: string
  vehicle_model: string | null
  booking_status: BookingStatus
  booking_end_at: string
  fuel_type: FuelType | null
  location_code: string | null
  service_code: string | null
  service_category: string | null
  related_plate: string | null
  started_by_name: string | null
  done_by_name: string | null
  photo_count: number
}

export type TaskKind = 'care' | 'charge_fuel' | 'relocate' | 'service'

/** Kategorie-Chip wie im Klick-Prototyp */
export function taskKind(t: Pick<BoardTask, 'type' | 'service_category'>): TaskKind {
  if (t.type === 'relocate') return 'relocate'
  if (t.type === 'charge' || t.type === 'fuel') return 'charge_fuel'
  if (t.service_category === 'cleaning') return 'care'
  return 'service'
}

export function taskKindLabel(t: Pick<BoardTask, 'type' | 'service_category'>): string {
  if (t.type === 'relocate') return 'Umsetzen'
  if (t.type === 'charge') return 'Laden'
  if (t.type === 'fuel') return 'Tanken'
  if (t.service_category === 'cleaning') return 'Aufbereitung'
  if (t.service_category === 'other') return 'Zusatz'
  return 'Service'
}

export type TaskFilter = 'all' | TaskKind | 'due_today'

export const TASK_FILTERS: [TaskFilter, string][] = [
  ['all', 'Alle'],
  ['care', 'Aufbereitung'],
  ['charge_fuel', 'Laden/Tanken'],
  ['relocate', 'Umsetzen'],
  ['service', 'Service'],
  ['due_today', 'Nur heute fällig'],
]

export function matchesFilter(t: BoardTask, f: TaskFilter, endOfToday: string): boolean {
  if (f === 'all') return true
  if (f === 'due_today') return !!t.due_at && t.due_at < endOfToday && t.status !== 'done'
  return taskKind(t) === f
}

/**
 * Board-Daten: alle offenen und laufenden Aufgaben aktiver Fahrzeuge plus heute erledigte.
 * (Menge ist durch die Anzahl Fahrzeuge auf dem Gelände begrenzt.)
 */
export async function loadTaskBoard(): Promise<BoardTask[]> {
  const today = berlinDayStart(0)
  const [active, doneToday] = await Promise.all([
    db()
      .from('task_board')
      .select('*')
      .in('status', ['open', 'in_progress'])
      .not('booking_status', 'in', '(completed,cancelled)')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(500),
    db()
      .from('task_board')
      .select('*')
      .eq('status', 'done')
      .gte('done_at', today)
      .order('done_at', { ascending: false })
      .limit(200),
  ])
  const failed = [active, doneToday].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  return [...(active.data ?? []), ...(doneToday.data ?? [])] as BoardTask[]
}

export async function getBoardTask(id: string): Promise<BoardTask> {
  const { data, error } = await db().from('task_board').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as BoardTask
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'status' | 'note' | 'checklist'>>,
): Promise<void> {
  const { error } = await db().from('tasks').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Ein Ladevorgang einer Ladeaufgabe (nach Abbruch zählt die Säule wieder ab 0) */
export interface EnergyPart {
  kwh: number
  at: string
}

export interface TaskEnergy {
  total: number | null
  parts: EnergyPart[]
}

/** Geladene kWh einer Ladeaufgabe (task_board enthält die Spalten nicht) */
export async function getTaskEnergy(id: string): Promise<TaskEnergy> {
  const { data, error } = await db().from('tasks').select('energy_kwh, energy_parts').eq('id', id).maybeSingle()
  if (error || !data) return { total: null, parts: [] }
  const row = data as { energy_kwh?: number | null; energy_parts?: EnergyPart[] | null }
  return {
    total: row.energy_kwh === null || row.energy_kwh === undefined ? null : Number(row.energy_kwh),
    parts: (row.energy_parts ?? []).map((p) => ({ kwh: Number(p.kwh), at: p.at })),
  }
}

/** Summe auf 3 Nachkommastellen (wie numeric(10,3)) */
export function sumEnergy(parts: Pick<EnergyPart, 'kwh'>[]): number {
  return Math.round(parts.reduce((sum, p) => sum + p.kwh, 0) * 1000) / 1000
}

/** Zwischenstand speichern (Aufgabe bleibt in Arbeit) */
export async function saveEnergyParts(id: string, parts: EnergyPart[]): Promise<void> {
  const { error } = await db()
    .from('tasks')
    .update({ energy_parts: parts, energy_kwh: parts.length ? sumEnergy(parts) : null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Ladeaufgabe abschließen: alle Ladevorgänge, Summe in energy_kwh */
export async function completeChargeTask(id: string, parts: EnergyPart[]): Promise<void> {
  const { error } = await db()
    .from('tasks')
    .update({ status: 'done', energy_parts: parts, energy_kwh: sumEnergy(parts) })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** "3,1 + 22,5" */
export function formatEnergyParts(parts: Pick<EnergyPart, 'kwh'>[]): string {
  return parts.map((p) => kwhFmt.format(p.kwh)).join(' + ')
}

/** kWh-Eingabe mit Dezimalkomma, höchstens 3 Nachkommastellen, 0–500; sonst null */
export function parseKwh(input: string): number | null {
  const s = input.trim().replace(/\s/g, '')
  if (!/^\d{1,3}([.,]\d{1,3})?$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return n >= 0 && n <= 500 ? n : null
}

const kwhFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 3 })

/** 23.4 → "23,4 kWh" */
export function formatKwh(value: number | null | undefined): string {
  return value === null || value === undefined ? '– kWh' : `${kwhFmt.format(Number(value))} kWh`
}

/** Teilschritt umschalten; erster Haken startet die Aufgabe automatisch. */
export async function toggleChecklistItem(task: BoardTask, index: number): Promise<ChecklistItem[]> {
  const checklist = task.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c))
  const patch: Partial<Pick<Task, 'status' | 'checklist'>> = { checklist }
  if (task.status === 'open' && checklist.some((c) => c.done)) patch.status = 'in_progress'
  await updateTask(task.id, patch)
  return checklist
}

/** Hochgeladene Fotos einer Aufgabe (nur Metadaten; Anzeige lädt Thumbnails). */
export async function listTaskPhotos(taskId: string): Promise<Media[]> {
  const { data, error } = await db()
    .from('media')
    .select('*')
    .eq('owner_type', 'task')
    .eq('owner_id', taskId)
    .eq('kind', 'photo')
    .not('uploaded_at', 'is', null)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as Media[]
}

/** Realtime nur auf Aufgaben (Abschnitt 11.5) */
export function subscribeTasks(onChange: () => void): () => void {
  if (!supabase) return () => undefined
  const channel = supabase
    .channel('aufgaben')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => onChange())
    .subscribe()
  return () => void supabase?.removeChannel(channel)
}
