// Edge Function booking-checkout: Online-Buchung der Landingpage mit PayPal-Zahlung.
// Deploy OHNE JWT-Prüfung (die Seite sendet anonym): supabase functions deploy booking-checkout --no-verify-jwt
//
// Aktionen (POST, JSON mit "action"):
//  * "tariffs"  → aktive Tarife mit Preisen (öffentlich)
//  * "create"   → Formular prüfen, Betrag serverseitig berechnen, PayPal-Bestellung anlegen
//  * "capture"  → Zahlung erfassen, prüfen, Buchung in bookings anlegen, Bestätigungsmail senden
//
// Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV (sandbox|live),
//          MAIL_FROM, RESEND_API_KEY (für die Bestätigung), optional INQUIRY_IP_SALT
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { mailerFromEnv } from '../_shared/mailer.ts'
import {
  berlinToUtcIso,
  type BookingInput,
  bookingRefFor,
  confirmationMail,
  type NormalizedBooking,
  type TariffRow,
  validateBooking,
  validateWithdrawal,
  type WithdrawalInput,
  withdrawalMails,
} from './logic.ts'
import { PayPalClient, PayPalError, paypalConfigFromEnv } from './paypal.ts'
import { AGB_PLAIN, AGB_VERSION, WIDERRUF_PLAIN } from './legal.ts'

const RATE_LIMIT = 10
const RATE_WINDOW_SECONDS = 60 * 60
const PARKING_LABEL: Record<string, string> = {
  indoor: 'Halle Premium (Indoor)',
  outdoor_cover: 'Außen mit Abdeckplane',
  outdoor: 'Außen ohne Plane',
}

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

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip')?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

async function loadTariffs(): Promise<TariffRow[]> {
  const { data, error } = await admin
    .from('booking_tariffs')
    .select('*')
    .eq('active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as TariffRow[]
}

function publicTariff(t: TariffRow) {
  return {
    code: t.code,
    label: t.label,
    parking_type: t.parking_type,
    shuttle_text: t.shuttle_text,
    included_text: t.included_text,
    price_week: Number(t.price_week),
    price_holiday: Number(t.price_holiday),
    price_month: Number(t.price_month),
  }
}

async function handleTariffs() {
  return json({ tariffs: (await loadTariffs()).map(publicTariff) })
}

async function handleCreate(req: Request, body: { form?: BookingInput }) {
  const paypalConfig = paypalConfigFromEnv(Deno.env)
  if (!paypalConfig) return json({ error: 'Die Online-Zahlung ist derzeit nicht verfügbar.' }, 503)

  const ipHash = `booking:${await hashIp(clientIp(req))}`
  const { data: allowed, error: rateErr } = await admin.rpc('inquiry_rate_check', {
    p_ip_hash: ipHash,
    p_limit: RATE_LIMIT,
    p_window: `${RATE_WINDOW_SECONDS} seconds`,
  })
  if (rateErr) throw rateErr
  if (allowed !== true) return json({ error: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.' }, 429)

  const tariffs = await loadTariffs()
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const { errors, value } = validateBooking(body.form ?? ({} as BookingInput), today, tariffs)
  if (!value) return json({ error: 'Bitte die markierten Felder prüfen.', fields: errors }, 422)

  const tariff = tariffs.find((t) => t.code === value.tariff_code)!
  const { data: checkout, error: insErr } = await admin
    .from('booking_checkouts')
    .insert({
      tariff_code: value.tariff_code,
      payload: value,
      amount: value.amount,
      currency: 'EUR',
      status: 'pending',
    })
    .select('id')
    .single()
  if (insErr) throw insErr

  const paypal = new PayPalClient(paypalConfig)
  let orderId: string
  try {
    orderId = await paypal.createOrder({
      referenceId: checkout.id,
      amount: value.amount,
      currency: 'EUR',
      description: `Park & Fly ${tariff.label} ${value.plate}`,
    })
  } catch (err) {
    console.error('paypal create failed', err instanceof PayPalError ? err.status : err)
    return json({ error: 'Die Zahlung konnte nicht vorbereitet werden. Bitte versuchen Sie es erneut.' }, 502)
  }
  await admin.from('booking_checkouts').update({ paypal_order_id: orderId, updated_at: new Date().toISOString() }).eq('id', checkout.id)

  return json({ checkout_id: checkout.id, paypal_order_id: orderId, amount: value.amount })
}

async function bookingRef(id: string): Promise<string> {
  return `PF-${id.slice(0, 8).toUpperCase()}`
}

async function handleCapture(body: { checkout_id?: string; paypal_order_id?: string }) {
  const paypalConfig = paypalConfigFromEnv(Deno.env)
  if (!paypalConfig) return json({ error: 'Die Online-Zahlung ist derzeit nicht verfügbar.' }, 503)

  const checkoutId = String(body.checkout_id ?? '')
  const orderId = String(body.paypal_order_id ?? '')
  const { data: checkout } = await admin.from('booking_checkouts').select('*').eq('id', checkoutId).maybeSingle()
  if (!checkout || checkout.paypal_order_id !== orderId) return json({ error: 'Unbekannte Bestellung.' }, 404)

  // Doppelter Aufruf (z. B. Netzwerk-Wiederholung): bereits erfasste Buchung zurückgeben
  if (checkout.status === 'captured' && checkout.booking_id) {
    return json({ booking_ref: await bookingRef(checkout.booking_id) })
  }

  const paypal = new PayPalClient(paypalConfig)
  let capture
  try {
    capture = await paypal.captureOrder(orderId)
  } catch (err) {
    console.error('paypal capture failed', err instanceof PayPalError ? err.status : err)
    return json({ error: 'Die Zahlung konnte nicht abgeschlossen werden. Es wurde nichts abgebucht.' }, 502)
  }

  const paid =
    capture.status === 'COMPLETED' &&
    capture.captureStatus === 'COMPLETED' &&
    capture.currency === 'EUR' &&
    capture.amount !== null &&
    Number(capture.amount) === Number(checkout.amount)
  if (!paid) {
    await admin
      .from('booking_checkouts')
      .update({ status: 'failed', failure_reason: `${capture.status}/${capture.captureStatus}`, updated_at: new Date().toISOString() })
      .eq('id', checkoutId)
    return json({ error: 'Die Zahlung wurde nicht bestätigt. Bitte versuchen Sie es erneut.' }, 402)
  }

  const value = checkout.payload as NormalizedBooking
  const { data: tariff } = await admin.from('booking_tariffs').select('*').eq('code', checkout.tariff_code).single()

  const notes = [
    `Tarif: ${tariff.label}`,
    value.return_mode === 'shuttle' ? `Flug Hinflug: ${value.flight_outbound ?? '–'} · Rückflug: ${value.flight_return ?? '–'}` : null,
    `Kindersitze: ${value.child_seats} · Gepäckstücke: ${value.luggage}`,
    `AGB ${AGB_VERSION} akzeptiert (${value.accepted_at}), Widerrufsbelehrung zur Kenntnis genommen`,
    `Vorzeitiger Leistungsbeginn: ${value.early_start ? 'ausdrücklich zugestimmt' : 'nicht relevant (Anreise außerhalb der Widerrufsfrist)'}`,
    value.notes,
  ]
    .filter(Boolean)
    .join('\n')
  const { data: booking, error: bookErr } = await admin
    .from('bookings')
    .insert({
      source: 'landing',
      external_ref: orderId,
      received_at: new Date().toISOString(),
      customer_name: value.customer_name,
      company: value.company,
      customer_email: value.email,
      customer_phone: value.phone,
      plate: value.plate,
      vehicle_model: value.vehicle_model,
      fuel_type: value.fuel_type,
      persons: value.persons,
      start_at: berlinToUtcIso(value.arrival_date, value.arrival_time),
      end_at: berlinToUtcIso(value.pickup_date, value.pickup_time),
      parking_type: tariff.parking_type,
      return_mode: value.return_mode,
      status: 'booked',
      price_total: value.amount,
      payment_status: 'paid',
      notes,
    })
    .select('id')
    .single()

  if (bookErr) {
    // Zahlung ist erfasst, aber die Buchung fehlt: nicht stillschweigend schlucken
    const { data: existing } = await admin
      .from('bookings')
      .select('id')
      .eq('source', 'landing')
      .eq('external_ref', orderId)
      .maybeSingle()
    if (!existing) {
      console.error('CRITICAL: payment captured but booking insert failed', orderId, bookErr.message)
      await admin
        .from('booking_checkouts')
        .update({ status: 'failed', failure_reason: 'booking_insert_failed', updated_at: new Date().toISOString() })
        .eq('id', checkoutId)
      return json({ error: 'Zahlung erfolgt, die Buchung konnte nicht angelegt werden. Bitte melden Sie sich bei uns.' }, 500)
    }
    return json({ booking_ref: await bookingRef(existing.id) })
  }

  await admin
    .from('booking_checkouts')
    .update({ status: 'captured', booking_id: booking.id, updated_at: new Date().toISOString() })
    .eq('id', checkoutId)

  await sendConfirmation(booking.id, value, tariff.label, checkout.tariff_code)

  return json({ booking_ref: await bookingRef(booking.id) })
}

async function sendConfirmation(bookingId: string, value: NormalizedBooking, tariffLabel: string, tariffCode: string) {
  const mailer = mailerFromEnv(Deno.env)
  if (!mailer) {
    console.warn('no mailer configured; confirmation not sent', bookingId)
    return
  }
  const { data: settings } = await admin
    .from('settings')
    .select('key, value')
    .in('key', ['mail_mode', 'mail_test_address', 'booking_confirmation_from'])
  const s = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]))
  const testMode = s.mail_mode !== 'live'
  const to = testMode ? (typeof s.mail_test_address === 'string' ? s.mail_test_address : null) : value.email
  if (!to) return
  const { data: t } = await admin.from('booking_tariffs').select('parking_type').eq('code', tariffCode).single()
  const mail = confirmationMail({
    bookingRef: `PF-${bookingId.slice(0, 8).toUpperCase()}`,
    booking: value,
    tariffLabel,
    parkingLabel: PARKING_LABEL[t?.parking_type ?? ''] ?? '',
    agbText: AGB_PLAIN,
    withdrawalText: WIDERRUF_PLAIN,
    agbVersion: AGB_VERSION,
  })
  try {
    await mailer.send({ to: [to], subject: testMode ? `[TEST] ${mail.subject}` : mail.subject, text: mail.text })
  } catch (err) {
    // Die Buchung ist bezahlt und gültig. Ein Mailfehler wird nur protokolliert.
    console.error('confirmation mail failed', bookingId, err instanceof Error ? err.message : err)
  }
}

const WITHDRAWAL_PERIOD_MS = 14 * 24 * 60 * 60 * 1000

/** Mailempfänger: im Testbetrieb immer die Testadresse, sonst Kunde bzw. Betriebsadresse */
async function mailSettings(): Promise<{ testMode: boolean; testAddress: string | null; notifyAddress: string | null }> {
  const { data } = await admin
    .from('settings')
    .select('key, value')
    .in('key', ['mail_mode', 'mail_test_address', 'inquiry_notify_address'])
  const s = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  return {
    testMode: s.mail_mode !== 'live',
    testAddress: typeof s.mail_test_address === 'string' ? s.mail_test_address : null,
    notifyAddress: typeof s.inquiry_notify_address === 'string' ? s.inquiry_notify_address : null,
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

async function handleWithdraw(req: Request, body: { form?: WithdrawalInput }) {
  const ipHash = `withdraw:${await hashIp(clientIp(req))}`
  const { data: allowed, error: rateErr } = await admin.rpc('inquiry_rate_check', {
    p_ip_hash: ipHash,
    p_limit: RATE_LIMIT,
    p_window: `${RATE_WINDOW_SECONDS} seconds`,
  })
  if (rateErr) throw rateErr
  if (allowed !== true) return json({ error: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.' }, 429)

  const input: WithdrawalInput = {
    booking_ref: String(body.form?.booking_ref ?? '').trim().toUpperCase(),
    email: String(body.form?.email ?? '').trim(),
    name: String(body.form?.name ?? '').trim(),
    reason: String(body.form?.reason ?? '').trim(),
    consent_withdraw: body.form?.consent_withdraw === true,
    website: String(body.form?.website ?? ''),
  }
  const errors = validateWithdrawal(input)
  if (Object.keys(errors).length > 0) return json({ error: 'Bitte die markierten Felder prüfen.', fields: errors }, 422)

  // Buchung über E-Mail-Adresse (ohne Groß-/Kleinschreibung) suchen, dann die Buchungsnummer abgleichen
  const { data: candidates } = await admin
    .from('bookings')
    .select('id, customer_name, customer_email, received_at')
    .eq('source', 'landing')
    .ilike('customer_email', escapeLike(input.email))
    .limit(50)
  const booking = (candidates ?? []).find((b) => bookingRefFor(b.id) === input.booking_ref)
  if (!booking)
    return json(
      { error: 'Zu dieser Buchungsnummer und E-Mail-Adresse finden wir keine Buchung. Bitte prüfen Sie die Angaben.' },
      404,
    )

  // Doppelter Widerruf: den ersten Eingang zurückgeben, keine zweite Erklärung anlegen
  const { data: existing } = await admin
    .from('booking_withdrawals')
    .select('received_at')
    .eq('booking_ref', input.booking_ref)
    .maybeSingle()
  if (existing) return json({ booking_ref: input.booking_ref, received_at: existing.received_at, duplicate: true })

  const receivedAt = new Date()
  const withinPeriod = receivedAt.getTime() - new Date(booking.received_at).getTime() <= WITHDRAWAL_PERIOD_MS
  const { data: bookingNotes } = await admin.from('bookings').select('notes').eq('id', booking.id).single()
  const earlyStart = /Vorzeitiger Leistungsbeginn: ausdrücklich zugestimmt/.test(bookingNotes?.notes ?? '')

  const { error: insErr } = await admin.from('booking_withdrawals').insert({
    booking_id: booking.id,
    booking_ref: input.booking_ref,
    customer_name: input.name,
    customer_email: input.email,
    reason: input.reason || null,
    received_at: receivedAt.toISOString(),
    within_period: withinPeriod,
    ip_hash: ipHash,
  })
  if (insErr) {
    if (insErr.code === '23505') {
      const { data: again } = await admin.from('booking_withdrawals').select('received_at').eq('booking_ref', input.booking_ref).single()
      return json({ booking_ref: input.booking_ref, received_at: again?.received_at, duplicate: true })
    }
    throw insErr
  }

  await sendWithdrawalMails(booking.id, input, receivedAt, withinPeriod, earlyStart)
  return json({ booking_ref: input.booking_ref, received_at: receivedAt.toISOString() })
}

async function sendWithdrawalMails(
  bookingId: string,
  input: WithdrawalInput,
  receivedAt: Date,
  withinPeriod: boolean,
  earlyStart: boolean,
) {
  const mailer = mailerFromEnv(Deno.env)
  if (!mailer) {
    console.warn('no mailer configured; withdrawal confirmation not sent', bookingId)
    return
  }
  const settings = await mailSettings()
  const mails = withdrawalMails({
    bookingRef: input.booking_ref,
    customerName: input.name,
    email: input.email,
    receivedAt,
    reason: input.reason || null,
    withinPeriod,
    earlyStart,
  })
  const tag = (subject: string) => (settings.testMode ? `[TEST] ${subject}` : subject)
  const customerTo = settings.testMode ? settings.testAddress : input.email
  const staffTo = settings.testMode ? settings.testAddress : (settings.notifyAddress ?? settings.testAddress)
  try {
    if (customerTo) await mailer.send({ to: [customerTo], subject: tag(mails.customer.subject), text: mails.customer.text })
    if (customerTo) {
      await admin.from('booking_withdrawals').update({ confirmation_sent: true }).eq('booking_ref', input.booking_ref)
    }
  } catch (err) {
    console.error('withdrawal confirmation failed', bookingId, err instanceof Error ? err.message : err)
  }
  try {
    if (staffTo) await mailer.send({ to: [staffTo], subject: tag(mails.staff.subject), text: mails.staff.text })
  } catch (err) {
    console.error('withdrawal staff notice failed', bookingId, err instanceof Error ? err.message : err)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

  let body: { action?: string; form?: BookingInput & WithdrawalInput; checkout_id?: string; paypal_order_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Ungültiges JSON' }, 400)
  }

  try {
    switch (body.action) {
      case 'tariffs':
        return await handleTariffs()
      case 'create':
        return await handleCreate(req, body)
      case 'capture':
        return await handleCapture(body)
      case 'withdraw':
        return await handleWithdraw(req, body)
      default:
        return json({ error: 'Unbekannte Aktion' }, 400)
    }
  } catch (err) {
    console.error('booking-checkout failed', err instanceof Error ? err.message : err)
    return json({ error: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.' }, 500)
  }
})
