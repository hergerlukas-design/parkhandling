// Edge Function media-retention
// Löscht Vollbild-Fotos nach Ablauf der Aufbewahrungsfrist (settings.media_retention_days) aus dem
// Storage und markiert die media-Zeile mit archived_at. Thumbnails, Unterschriften und PDFs bleiben.
//
// Aufruf:
//  * täglich aus pg_cron (media_retention_tick) mit Header x-cron-secret – läuft nur, wenn
//    settings.media_retention_job_enabled = true
//  * von Admins aus den Einstellungen („Jetzt ausführen“) – läuft auch bei ausgeschaltetem Job
// Deploy ohne JWT-Prüfung am Gateway (verify_jwt = false), die Funktion prüft selbst.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const BATCH = 100
/** Obergrenze je Lauf, damit ein Aufruf sicher im Zeitlimit bleibt; der Rest folgt am nächsten Tag. */
const MAX_PER_RUN = 2000

interface Due {
  id: string
  bucket: string
  path: string
  bytes: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  let trigger: 'cron' | 'manual'
  let triggeredBy: string | null = null
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret) {
    const { data: ok } = await admin.rpc('media_retention_check_secret', { p_secret: cronSecret })
    if (ok !== true) return json({ error: 'Kein Zugriff' }, 403)
    trigger = 'cron'
  } else {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Nicht angemeldet' }, 401)
    const { data: isAdmin } = await userClient.rpc('is_admin')
    if (isAdmin !== true) return json({ error: 'Nur Admins' }, 403)
    trigger = 'manual'
    triggeredBy = userData.user.id
  }

  const { data: settingRows } = await admin
    .from('settings')
    .select('key, value')
    .in('key', ['media_retention_days', 'media_retention_job_enabled'])
  const settings = Object.fromEntries((settingRows ?? []).map((r) => [r.key, r.value]))
  if (trigger === 'cron' && settings.media_retention_job_enabled !== true) {
    return json({ status: 'disabled' })
  }

  const { data: run, error: runError } = await admin
    .from('media_retention_runs')
    .insert({ trigger, triggered_by: triggeredBy, retention_days: Number(settings.media_retention_days ?? 365) })
    .select('id')
    .single()
  if (runError || !run) return json({ error: runError?.message ?? 'Lauf konnte nicht angelegt werden' }, 500)

  let deleted = 0
  let freed = 0
  let failed = 0
  let error: string | null = null

  try {
    while (deleted + failed < MAX_PER_RUN) {
      const { data, error: dueError } = await admin.rpc('media_retention_due', { p_limit: BATCH })
      if (dueError) throw dueError
      const due = (data ?? []) as Due[]
      if (due.length === 0) break

      const byBucket = new Map<string, Due[]>()
      for (const d of due) byBucket.set(d.bucket, [...(byBucket.get(d.bucket) ?? []), d])

      let progressed = 0
      for (const [bucket, items] of byBucket) {
        // remove() ignoriert fehlende Dateien – ein früher abgebrochener Lauf wird hier sauber beendet
        const { error: removeError } = await admin.storage.from(bucket).remove(items.map((i) => i.path))
        if (removeError) {
          failed += items.length
          error = removeError.message
          continue
        }
        const { error: markError } = await admin
          .from('media')
          .update({ archived_at: new Date().toISOString() })
          .in('id', items.map((i) => i.id))
        if (markError) {
          failed += items.length
          error = markError.message
          continue
        }
        deleted += items.length
        freed += items.reduce((sum, i) => sum + Number(i.bytes), 0)
        progressed += items.length
      }
      // Kein Fortschritt (z. B. Storage-Fehler) → abbrechen statt dieselben Dateien endlos zu versuchen
      if (progressed === 0) break
    }
  } catch (e) {
    error = (e as Error).message
  }

  await admin
    .from('media_retention_runs')
    .update({ finished_at: new Date().toISOString(), deleted_count: deleted, freed_bytes: freed, failed_count: failed, error })
    .eq('id', run.id)

  return json({ status: error ? 'partial' : 'ok', deleted, freed_bytes: freed, failed, error }, error && deleted === 0 ? 500 : 200)
})
