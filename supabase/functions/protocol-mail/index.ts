// Edge Function protocol-mail
// Versendet das PDF eines abgeschlossenen Protokolls per E-Mail (Abschnitt 9/10).
//
//  * Prototyp: settings.mail_mode = "test" → Empfänger ist IMMER settings.mail_test_address
//  * Versand über Resend (https://resend.com). Ohne Secret RESEND_API_KEY wird nichts gesendet,
//    der Status wird als "not_configured" gespeichert.
//  * Secrets: RESEND_API_KEY, MAIL_FROM (z. B. "Park & Fly <protokoll@example.com>")
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const TEMPLATE_KEY = { intake: 'protocol_intake', handover: 'protocol_handover' } as const

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isStaff } = await userClient.rpc('is_staff')
  if (!isStaff) return json({ error: 'Kein Zugriff' }, 403)

  let protocolId: string
  try {
    protocolId = (await req.json()).protocol_id
  } catch {
    return json({ error: 'Ungültiges JSON' }, 400)
  }
  if (!/^[0-9a-f-]{36}$/i.test(protocolId ?? '')) return json({ error: 'protocol_id fehlt' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: p, error } = await admin
    .from('protocols')
    .select('id, type, status, pdf_media_id, booking:bookings(plate, customer_name, customer_email, end_at)')
    .eq('id', protocolId)
    .single()
  if (error || !p) return json({ error: 'Protokoll nicht gefunden' }, 404)
  if (p.status !== 'final' || !p.pdf_media_id) return json({ error: 'Protokoll nicht abgeschlossen oder PDF fehlt' }, 409)

  const setStatus = (mail_status: string, mail_error: string | null = null, sent = false) =>
    admin.from('protocols').update({ mail_status, mail_error, ...(sent ? { sent_at: new Date().toISOString() } : {}) }).eq('id', protocolId)

  const settings = Object.fromEntries(
    ((await admin.from('settings').select('key, value').in('key', ['mail_mode', 'mail_test_address', 'email_templates', 'email_triggers'])).data ?? [])
      .map((r) => [r.key, r.value]),
  )
  const templateKey = TEMPLATE_KEY[p.type as 'intake' | 'handover']
  if (settings.email_triggers?.[templateKey] === false) {
    await setStatus('disabled')
    return json({ status: 'disabled' })
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('MAIL_FROM')
  if (!apiKey || !from) {
    await setStatus('not_configured')
    return json({ status: 'not_configured' })
  }

  const booking = p.booking as unknown as { plate: string; customer_name: string; customer_email: string | null }
  const recipient = settings.mail_mode === 'live' ? booking.customer_email : settings.mail_test_address
  if (!recipient) {
    await setStatus('failed', 'Keine Empfängeradresse')
    return json({ status: 'failed', error: 'Keine Empfängeradresse' }, 422)
  }

  const { data: media } = await admin.from('media').select('bucket, path').eq('id', p.pdf_media_id).single()
  const file = media ? await admin.storage.from(media.bucket).download(media.path) : null
  if (!file?.data) {
    await setStatus('failed', 'PDF nicht ladbar')
    return json({ status: 'failed', error: 'PDF nicht ladbar' }, 500)
  }

  const tpl = settings.email_templates?.[templateKey] ?? { subject: 'Ihr Protokoll – {{plate}}', body: 'Anbei Ihr Protokoll.' }
  const values = { plate: booking.plate, customer_name: booking.customer_name }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: (settings.mail_mode === 'live' ? '' : '[TEST] ') + fill(tpl.subject, values),
      text: fill(tpl.body, values),
      attachments: [
        { filename: `${booking.plate.replace(/\s/g, '-')}_${p.type === 'intake' ? 'Annahme' : 'Uebergabe'}.pdf`,
          content: toBase64(new Uint8Array(await file.data.arrayBuffer())) },
      ],
    }),
  })
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 300)
    await setStatus('failed', msg)
    return json({ status: 'failed', error: msg }, 502)
  }
  await setStatus('sent', null, true)
  return json({ status: 'sent', recipient })
})
