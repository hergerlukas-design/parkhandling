// Edge Function inquiry-submit
// Nimmt Anfragen der Landingpage entgegen (anonym, ohne Login). Deploy OHNE JWT-Prüfung:
//   supabase functions deploy inquiry-submit --no-verify-jwt
// Secrets: RESEND_API_KEY, MAIL_FROM (wie protocol-mail), optional MAIL_PROVIDER,
// optional INQUIRY_IP_SALT (Schlüssel für den IP-HMAC; Standard: service_role-Key).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { mailerFromEnv } from '../_shared/mailer.ts'
import { createInquiryHandler, type InquiryStore, type MailSettings } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const hmacKey = crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(Deno.env.get('INQUIRY_IP_SALT') ?? serviceKey),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
)

async function hashIp(ip: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey, new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

const store: InquiryStore = {
  async checkRateLimit(ipHash, limit, windowSeconds) {
    const { data, error } = await admin.rpc('inquiry_rate_check', {
      p_ip_hash: ipHash,
      p_limit: limit,
      p_window: `${windowSeconds} seconds`,
    })
    if (error) throw error
    return data === true
  },
  async insert(row) {
    const { data, error } = await admin.from('inquiries').insert(row).select('id').single()
    if (error) throw error
    return data.id as string
  },
  async loadMailSettings(): Promise<MailSettings> {
    const { data } = await admin
      .from('settings')
      .select('key, value')
      .in('key', ['mail_mode', 'mail_test_address', 'inquiry_notify_address', 'inquiry_customer_confirmation'])
    const s = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
    return {
      mailMode: s.mail_mode === 'live' ? 'live' : 'test',
      testAddress: typeof s.mail_test_address === 'string' ? s.mail_test_address : null,
      notifyAddress: typeof s.inquiry_notify_address === 'string' ? s.inquiry_notify_address : null,
      customerConfirmation: s.inquiry_customer_confirmation === true,
    }
  },
  async setNotificationStatus(id, status) {
    await admin.from('inquiries').update({ notification_status: status }).eq('id', id)
  },
}

Deno.serve(createInquiryHandler({ store, mailer: mailerFromEnv(Deno.env), hashIp }))
