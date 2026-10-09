// Ablauf der Edge Function inquiry-submit, ohne Deno-/Supabase-Abhängigkeiten (testbar mit Fakes).
//
//  1. Rate-Limit je IP (HMAC, nie die IP selbst): höchstens RATE_LIMIT Versuche pro Stunde → 429
//  2. Honeypot gefüllt oder Formular in unter MIN_FILL_MS ausgefüllt → still verwerfen
//     (Antwort wie bei Erfolg, damit Bots nichts lernen; nichts wird gespeichert)
//  3. Serverseitige Prüfung → 422 mit Feldfehlern
//  4. Speichern in public.inquiries
//  5. Benachrichtigung an den Betrieb; Bestätigung an den Kunden nur, wenn per Flag aktiviert.
//     Ein Mail-Fehler macht die Anfrage nicht ungültig, er wird in notification_status vermerkt.
import { corsHeaders, json } from '../_shared/cors.ts'
import type { Mailer } from '../_shared/mailer.ts'
import { formatDateDE, type InquiryInput, todayInBerlin, validateInquiry } from './validation.ts'

export const RATE_LIMIT = 5
export const RATE_WINDOW_SECONDS = 60 * 60
export const MIN_FILL_MS = 3000
const MAX_BODY_BYTES = 20_000

export type NotificationStatus = 'sent' | 'not_configured' | 'failed'

export interface MailSettings {
  mailMode: 'test' | 'live'
  testAddress: string | null
  notifyAddress: string | null
  customerConfirmation: boolean
}

export interface InquiryRow extends InquiryInput {
  consent_privacy_at: string
}

export interface InquiryStore {
  /** Zählt den Versuch; false, wenn das Limit erreicht ist. */
  checkRateLimit(ipHash: string, limit: number, windowSeconds: number): Promise<boolean>
  insert(row: InquiryRow): Promise<string>
  loadMailSettings(): Promise<MailSettings>
  setNotificationStatus(id: string, status: NotificationStatus): Promise<void>
}

export interface HandlerDeps {
  store: InquiryStore
  mailer: Mailer | null
  hashIp: (ip: string) => Promise<string>
  now?: () => Date
  log?: (event: string, data?: Record<string, unknown>) => void
}

const PARKING_LABEL: Record<string, string> = {
  indoor: 'Halle Premium (Indoor)',
  outdoor_cover: 'Außen mit Abdeckplane',
  outdoor: 'Außen ohne Plane',
  any: 'egal',
}
const SERVICE_LABEL: Record<string, string> = {
  shuttle: 'Shuttle',
  detailing: 'Fahrzeugaufbereitung',
  pickup_delivery: 'Hol- & Bringservice',
}

/** Client-IP: Cloudflare-Header zuerst (wird vom Edge-Proxy gesetzt), sonst erster X-Forwarded-For-Eintrag */
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return xff || 'unknown'
}

export function notificationMail(row: InquiryInput, mailMode: MailSettings['mailMode']) {
  const prefix = mailMode === 'live' ? '' : '[TEST] '
  const lines = [
    'Neue unverbindliche Anfrage über die Landingpage:',
    '',
    `Anreise:       ${formatDateDE(row.arrival_date)}`,
    `Abholung:      ${formatDateDE(row.pickup_date)}`,
    `Stellplatz:    ${PARKING_LABEL[row.parking_type]}`,
    `Kennzeichen:   ${row.plate}`,
    `Name:          ${row.first_name} ${row.last_name}`,
    `E-Mail:        ${row.email}`,
    `Telefon:       ${row.phone ?? '–'}`,
    `Leistungen:    ${row.services.map((s) => SERVICE_LABEL[s]).join(', ') || '–'}`,
    '',
    'Nachricht:',
    row.message ?? '–',
    '',
    `Quelle: ${[row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean).join(' / ') || 'direkt'}`,
    '',
    'Bitte im Supabase-Dashboard (Tabelle inquiries) prüfen und den Kunden kontaktieren.',
  ]
  return {
    subject: `${prefix}Neue Anfrage ${formatDateDE(row.arrival_date)}–${formatDateDE(row.pickup_date)} (${row.plate})`,
    text: lines.join('\n'),
  }
}

export function confirmationMail(row: InquiryInput, mailMode: MailSettings['mailMode']) {
  const prefix = mailMode === 'live' ? '' : '[TEST] '
  return {
    subject: `${prefix}Ihre Anfrage bei Park & Fly München`,
    text: [
      `Guten Tag ${row.first_name} ${row.last_name},`,
      '',
      `vielen Dank für Ihre Anfrage für den Zeitraum ${formatDateDE(row.arrival_date)} bis ${formatDateDE(row.pickup_date)}.`,
      'Wir melden uns in Kürze mit einem Angebot. Ihre Anfrage ist unverbindlich und noch keine Buchung.',
      '',
      'Ihr Park & Fly Team',
    ].join('\n'),
  }
}

export function createInquiryHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((event, data) => console.log(JSON.stringify({ fn: 'inquiry-submit', event, ...data })))

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Anfrage zu groß' }, 413)
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('kein Objekt')
    } catch {
      return json({ error: 'Ungültiges JSON' }, 400)
    }

    const ipHash = await deps.hashIp(clientIp(req))
    if (!(await deps.store.checkRateLimit(ipHash, RATE_LIMIT, RATE_WINDOW_SECONDS))) {
      log('rate_limited')
      return json({ error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' }, 429)
    }

    if (typeof body.website === 'string' && body.website.trim() !== '') {
      log('discarded', { reason: 'honeypot' })
      return json({ ok: true })
    }
    const fillMs = body.form_duration_ms
    if (typeof fillMs !== 'number' || !Number.isFinite(fillMs) || fillMs < MIN_FILL_MS) {
      log('discarded', { reason: 'too_fast' })
      return json({ ok: true })
    }

    const result = validateInquiry(body, todayInBerlin(now()))
    if (!result.ok) return json({ error: 'Bitte die markierten Felder prüfen.', fields: result.errors }, 422)
    const row = result.value

    let id: string
    try {
      id = await deps.store.insert({ ...row, consent_privacy_at: now().toISOString() })
    } catch (e) {
      log('insert_failed', { error: String(e) })
      return json({ error: 'Die Anfrage konnte nicht gespeichert werden. Bitte später erneut versuchen.' }, 500)
    }
    log('stored', { id })

    try {
      const settings = await deps.store.loadMailSettings()
      const status = await notify(deps.mailer, settings, row)
      await deps.store.setNotificationStatus(id, status)
      log('notification', { id, status })
      if (settings.customerConfirmation && deps.mailer) {
        const to = settings.mailMode === 'live' ? row.email : settings.testAddress
        if (to) await deps.mailer.send({ to: [to], ...confirmationMail(row, settings.mailMode) })
      }
    } catch (e) {
      log('mail_error', { id, error: String(e) })
    }

    return json({ ok: true })
  }
}

async function notify(mailer: Mailer | null, settings: MailSettings, row: InquiryInput): Promise<NotificationStatus> {
  const to = settings.notifyAddress ?? settings.testAddress
  if (!mailer || !to) return 'not_configured'
  try {
    await mailer.send({ to: [to], replyTo: row.email, ...notificationMail(row, settings.mailMode) })
    return 'sent'
  } catch {
    return 'failed'
  }
}
