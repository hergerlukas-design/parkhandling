// Edge Function push-send
// Versendet offene Push-Benachrichtigungen aus public.notifications (Outbox) per Web Push.
//
//  * Aufruf nur intern: per pg_net aus der Datenbank (dispatch_push) mit Header x-push-secret.
//    Kein Aufruf aus dem Browser, keine Nutzerdaten im Request.
//  * Empfänger und Inhalte liefert claim_push_batch(), das Ergebnis geht über finish_push() zurück.
//    404/410 vom Push-Dienst schalten das Abo ab, sonst nach 5 Fehlern.
//  * Verschlüsselung (RFC 8291) und VAPID (RFC 8292) ohne Fremdbibliothek: ../_shared/webpush.ts
//
// Schlüssel: standardmäßig aus der Datenbank (push_send_config(): Vault push_vapid_private_key und
// push_send_secret, settings.push_vapid_public_key/push_vapid_subject). Optional überschreiben
// Function-Secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SEND_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildPushRequest, type VapidKeys } from '../_shared/webpush.ts'

interface Recipient {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface BatchItem {
  id: string
  payload: Record<string, unknown>
  recipients: Recipient[]
}

interface SendResult {
  subscription_id: string
  ok: boolean
  gone?: boolean
  error?: string
}

const MAX_ROUNDS = 5

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function sendOne(r: Recipient, payload: Record<string, unknown>, keys: VapidKeys): Promise<SendResult> {
  try {
    const req = await buildPushRequest(r, payload, keys, { ttlSeconds: 4 * 3600, urgency: 'high' })
    const res = await fetch(req.endpoint, { method: 'POST', headers: req.headers, body: req.body })
    await res.body?.cancel()
    if (res.ok) return { subscription_id: r.id, ok: true }
    return {
      subscription_id: r.id,
      ok: false,
      gone: res.status === 404 || res.status === 410,
      error: `HTTP ${res.status}`,
    }
  } catch (err) {
    return { subscription_id: r.id, ok: false, error: String((err as Error).message ?? err).slice(0, 200) }
  }
}

interface PushConfig {
  public_key: string
  private_key: string
  subject: string
  secret: string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return respond({ error: 'Methode nicht erlaubt' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: cfgData, error: cfgError } = await db.rpc('push_send_config')
  if (cfgError) return respond({ error: `push_send_config: ${cfgError.message}` }, 500)
  const cfg = (cfgData ?? {}) as Partial<PushConfig>

  const secret = Deno.env.get('PUSH_SEND_SECRET') || cfg.secret || ''
  if (!secret || !safeEqual(req.headers.get('x-push-secret') ?? '', secret)) {
    return respond({ error: 'Nicht berechtigt' }, 401)
  }

  const keys: VapidKeys = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || cfg.public_key || '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || cfg.private_key || '',
    subject: Deno.env.get('VAPID_SUBJECT') || cfg.subject || 'https://parkhandling.fly.dev',
  }
  if (!keys.publicKey || !keys.privateKey) {
    return respond({ error: 'VAPID-Schlüssel fehlen (Vault push_vapid_private_key / settings.push_vapid_public_key)' }, 500)
  }

  let notifications = 0
  let delivered = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await db.rpc('claim_push_batch', { p_limit: 50 })
    if (error) return respond({ error: `claim_push_batch: ${error.message}` }, 500)
    const batch = (data ?? []) as BatchItem[]
    if (batch.length === 0) break

    for (const item of batch) {
      const results = await Promise.all(item.recipients.map((r) => sendOne(r, item.payload, keys)))
      const { error: finishError } = await db.rpc('finish_push', { p_id: item.id, p_results: results })
      if (finishError) console.error('finish_push', item.id, finishError.message)
      notifications++
      delivered += results.filter((r) => r.ok).length
    }
  }

  return respond({ ok: true, notifications, delivered })
})
