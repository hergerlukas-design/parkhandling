// Edge Function media-sign
// Stellt Signed Upload URLs für den privaten Bucket `media` aus und legt die media-Zeile an.
// Dateien laufen NIE über diese Funktion – das Gerät lädt direkt in den Storage hoch.
//
// Schutzmechanismen (Abschnitt 11.6):
//  * nur freigeschaltetes Personal (profiles.active)
//  * max. Dateigröße (settings.upload_limits.max_bytes, zusätzlich hartes Bucket-Limit)
//  * Rate-Limit pro Nutzer und Gerät (settings.upload_limits.max_uploads_per_minute)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const BUCKET = 'media'
const OWNER_TYPES = ['task', 'protocol', 'damage'] as const
const KINDS = ['photo', 'signature', 'pdf'] as const
const MIME_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SignRequest {
  booking_id?: string | null
  owner_type: (typeof OWNER_TYPES)[number]
  owner_id?: string | null
  kind: (typeof KINDS)[number]
  content_type: string
  bytes: number
  thumb_content_type?: string | null
  thumb_bytes?: number | null
  width?: number | null
  height?: number | null
  taken_at?: string | null
  device_id: string
}

function validate(body: Partial<SignRequest>): string | null {
  if (!body || typeof body !== 'object') return 'Ungültige Anfrage'
  if (!OWNER_TYPES.includes(body.owner_type as never)) return 'owner_type ungültig'
  if (!KINDS.includes(body.kind as never)) return 'kind ungültig'
  if (!body.content_type || !MIME_EXT[body.content_type]) return 'content_type nicht erlaubt'
  if (body.thumb_content_type && !MIME_EXT[body.thumb_content_type]) return 'thumb_content_type nicht erlaubt'
  if (!Number.isInteger(body.bytes) || (body.bytes as number) <= 0) return 'bytes ungültig'
  if (body.booking_id && !UUID.test(body.booking_id)) return 'booking_id ungültig'
  if (body.owner_id && !UUID.test(body.owner_id)) return 'owner_id ungültig'
  if (!body.device_id || body.device_id.length > 64) return 'device_id fehlt'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // Client im Namen des Nutzers (RLS greift) für Berechtigungsprüfung
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Nicht angemeldet' }, 401)
  const { data: isStaff } = await userClient.rpc('is_staff')
  if (!isStaff) return json({ error: 'Kein Zugriff' }, 403)

  let body: SignRequest
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Ungültiges JSON' }, 400)
  }
  const invalid = validate(body)
  if (invalid) return json({ error: invalid }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: limitsRow } = await admin.from('settings').select('value').eq('key', 'upload_limits').maybeSingle()
  const limits = { max_bytes: 1_500_000, max_uploads_per_minute: 60, ...(limitsRow?.value ?? {}) }
  if (body.bytes > limits.max_bytes || (body.thumb_bytes ?? 0) > limits.max_bytes) {
    return json({ error: `Datei zu groß (max. ${limits.max_bytes} Bytes)` }, 413)
  }

  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin
    .from('media')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userData.user.id)
    .eq('device_id', body.device_id)
    .gte('created_at', since)
  if ((count ?? 0) >= limits.max_uploads_per_minute) {
    return json({ error: 'Zu viele Uploads – bitte kurz warten' }, 429)
  }

  // Unveränderliche Dateinamen <uuid>.<ext> → lange HTTP-Cache-Laufzeit möglich
  const id = crypto.randomUUID()
  const now = new Date()
  const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${body.booking_id ?? 'ohne-buchung'}`
  const path = `${prefix}/${id}.${MIME_EXT[body.content_type]}`
  const thumbPath = body.thumb_content_type ? `${prefix}/${id}_thumb.${MIME_EXT[body.thumb_content_type]}` : null

  const storage = admin.storage.from(BUCKET)
  const main = await storage.createSignedUploadUrl(path)
  if (main.error) return json({ error: main.error.message }, 500)
  const thumb = thumbPath ? await storage.createSignedUploadUrl(thumbPath) : null
  if (thumb?.error) return json({ error: thumb.error.message }, 500)

  const { error: insertError } = await admin.from('media').insert({
    id,
    booking_id: body.booking_id ?? null,
    owner_type: body.owner_type,
    owner_id: body.owner_id ?? null,
    kind: body.kind,
    provider: 'supabase',
    bucket: BUCKET,
    path,
    thumb_path: thumbPath,
    width: body.width ?? null,
    height: body.height ?? null,
    bytes: body.bytes,
    thumb_bytes: body.thumb_bytes ?? 0,
    mime_type: body.content_type,
    taken_at: body.taken_at ?? null,
    device_id: body.device_id,
    created_by: userData.user.id,
  })
  if (insertError) return json({ error: insertError.message }, 500)

  return json({
    media_id: id,
    provider: 'supabase',
    bucket: BUCKET,
    path,
    thumb_path: thumbPath,
    upload_url: main.data.signedUrl,
    thumb_upload_url: thumb?.data?.signedUrl ?? null,
    expires_at: new Date(now.getTime() + 2 * 60 * 60 * 1000 - 60_000).toISOString(),
  })
})
