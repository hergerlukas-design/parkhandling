import { supabase } from './supabase'

/** Aufbewahrung von Vollbild-Fotos (Arbeitsanweisung 11.4); Thumbnails, Unterschriften und PDFs bleiben. */
export interface RetentionConfig {
  days: number
  enabled: boolean
}

export interface RetentionPreview {
  dueCount: number
  dueBytes: number
  oldestEndAt: string | null
}

export interface RetentionRun {
  id: string
  trigger: 'cron' | 'manual'
  started_at: string
  finished_at: string | null
  retention_days: number
  deleted_count: number
  freed_bytes: number
  failed_count: number
  error: string | null
}

export const RETENTION_MIN_DAYS = 30
export const RETENTION_MAX_DAYS = 3650

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export async function loadRetentionConfig(): Promise<RetentionConfig> {
  const { data, error } = await db()
    .from('settings')
    .select('key, value')
    .in('key', ['media_retention_days', 'media_retention_job_enabled'])
  if (error) throw new Error('Einstellungen konnten nicht geladen werden')
  const values = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return { days: Number(values.media_retention_days ?? 365), enabled: values.media_retention_job_enabled === true }
}

async function saveSetting(key: string, value: unknown): Promise<void> {
  const { error } = await db().from('settings').update({ value }).eq('key', key)
  if (error) throw new Error('Einstellung konnte nicht gespeichert werden')
}

export async function saveRetentionConfig(config: RetentionConfig): Promise<void> {
  if (!Number.isInteger(config.days) || config.days < RETENTION_MIN_DAYS || config.days > RETENTION_MAX_DAYS) {
    throw new Error(`Frist: ${RETENTION_MIN_DAYS} bis ${RETENTION_MAX_DAYS} Tage`)
  }
  await saveSetting('media_retention_days', config.days)
  await saveSetting('media_retention_job_enabled', config.enabled)
}

export async function loadRetentionPreview(): Promise<RetentionPreview> {
  const { data, error } = await db().rpc('media_retention_preview').single<{
    due_count: number
    due_bytes: number
    oldest_end_at: string | null
  }>()
  if (error || !data) throw new Error('Vorschau konnte nicht geladen werden')
  return { dueCount: Number(data.due_count), dueBytes: Number(data.due_bytes), oldestEndAt: data.oldest_end_at }
}

export async function listRetentionRuns(limit = 5): Promise<RetentionRun[]> {
  const { data, error } = await db()
    .from('media_retention_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error('Protokoll konnte nicht geladen werden')
  return (data ?? []) as RetentionRun[]
}

/** Löscht alle fälligen Vollbilder sofort (Admin), unabhängig vom täglichen Job. */
export async function runRetentionNow(): Promise<{ deleted: number; failed: number; error: string | null }> {
  const { data, error } = await db().functions.invoke<{ deleted: number; failed: number; error: string | null }>(
    'media-retention',
    { body: { mode: 'manual' } },
  )
  if (error || !data) throw new Error('Löschlauf fehlgeschlagen')
  return data
}
