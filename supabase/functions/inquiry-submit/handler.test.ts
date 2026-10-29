// deno test supabase/functions/inquiry-submit
import * as assert from 'jsr:@std/assert@1'
import type { MailMessage, Mailer } from '../_shared/mailer.ts'
import { createInquiryHandler, type InquiryRow, type InquiryStore, type MailSettings, RATE_LIMIT } from './handler.ts'

const NOW = new Date('2026-10-09T10:00:00Z')

class FakeStore implements InquiryStore {
  rows: (InquiryRow & { id: string; notification_status?: string })[] = []
  hits = new Map<string, number>()
  settings: MailSettings = { mailMode: 'test', testAddress: 'test@example.com', notifyAddress: null, customerConfirmation: false }

  checkRateLimit(ipHash: string, limit: number) {
    const n = this.hits.get(ipHash) ?? 0
    if (n >= limit) return Promise.resolve(false)
    this.hits.set(ipHash, n + 1)
    return Promise.resolve(true)
  }
  insert(row: InquiryRow) {
    const id = crypto.randomUUID()
    this.rows.push({ ...row, id })
    return Promise.resolve(id)
  }
  loadMailSettings() {
    return Promise.resolve(this.settings)
  }
  setNotificationStatus(id: string, status: string) {
    this.rows.find((r) => r.id === id)!.notification_status = status
    return Promise.resolve()
  }
}

class FakeMailer implements Mailer {
  sent: MailMessage[] = []
  fail = false
  send(m: MailMessage) {
    if (this.fail) return Promise.reject(new Error('down'))
    this.sent.push(m)
    return Promise.resolve()
  }
}

function setup() {
  const store = new FakeStore()
  const mailer = new FakeMailer()
  const handler = createInquiryHandler({
    store,
    mailer,
    hashIp: (ip) => Promise.resolve(`hash:${ip}`),
    now: () => NOW,
    log: () => {},
  })
  return { store, mailer, handler }
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    arrival_date: '2026-10-12',
    pickup_date: '2026-10-19',
    parking_type: 'indoor',
    plate: 'm-te 123',
    first_name: 'Test',
    last_name: 'Person',
    email: 'test.person@example.com',
    phone: '',
    services: ['shuttle', 'detailing'],
    message: 'Ankunft gegen 6 Uhr',
    consent_privacy: true,
    website: '',
    form_duration_ms: 12_000,
    utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'herbst', utm_content: 'anzeige-a', utm_term: 'parken muc' },
    referrer: 'https://www.google.com/',
    ...overrides,
  }
}

function post(body: unknown, ip = '203.0.113.7') {
  return new Request('http://localhost/inquiry-submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  })
}

Deno.test('gültige Anfrage wird gespeichert, UTM-Werte übernommen, Betrieb benachrichtigt', async () => {
  const { store, mailer, handler } = setup()
  const res = await handler(post(validBody()))
  assert.assertEquals(res.status, 200)
  assert.assertEquals(await res.json(), { ok: true })
  assert.assertEquals(store.rows.length, 1)
  const row = store.rows[0]
  assert.assertEquals(row.plate, 'M-TE 123')
  assert.assertEquals(row.phone, null)
  assert.assertEquals(row.services, ['shuttle', 'detailing'])
  assert.assertEquals(row.utm_source, 'google')
  assert.assertEquals(row.utm_medium, 'cpc')
  assert.assertEquals(row.utm_campaign, 'herbst')
  assert.assertEquals(row.utm_content, 'anzeige-a')
  assert.assertEquals(row.utm_term, 'parken muc')
  assert.assertEquals(row.referrer, 'https://www.google.com/')
  assert.assertEquals(row.consent_privacy_at, NOW.toISOString())
  assert.assertEquals(row.notification_status, 'sent')
  assert.assertEquals(mailer.sent.length, 1, 'nur Betriebsmail, Kundenbestätigung ist aus')
  assert.assertEquals(mailer.sent[0].to, ['test@example.com'])
  assert.assertEquals(mailer.sent[0].replyTo, 'test.person@example.com')
  assert.assertMatch(mailer.sent[0].subject, /^\[TEST\] Neue Anfrage 12\.10\.2026–19\.10\.2026/)
})

Deno.test('Honeypot gefüllt: nichts gespeichert, keine Mail, Antwort wie Erfolg', async () => {
  const { store, mailer, handler } = setup()
  const res = await handler(post(validBody({ website: 'https://spam.example' })))
  assert.assertEquals(res.status, 200)
  assert.assertEquals(store.rows.length, 0)
  assert.assertEquals(mailer.sent.length, 0)
})

Deno.test('Formular unter 3 Sekunden ausgefüllt oder ohne Zeitangabe: verworfen', async () => {
  const { store, handler } = setup()
  assert.assertEquals((await handler(post(validBody({ form_duration_ms: 1200 })))).status, 200)
  assert.assertEquals((await handler(post(validBody({ form_duration_ms: undefined })))).status, 200)
  assert.assertEquals(store.rows.length, 0)
})

Deno.test('Rate-Limit: 6. Anfrage derselben IP innerhalb einer Stunde → 429, andere IP frei', async () => {
  const { store, handler } = setup()
  for (let i = 0; i < RATE_LIMIT; i++) assert.assertEquals((await handler(post(validBody()))).status, 200)
  const blocked = await handler(post(validBody()))
  assert.assertEquals(blocked.status, 429)
  assert.assertEquals(store.rows.length, RATE_LIMIT)
  assert.assertEquals((await handler(post(validBody(), '198.51.100.1'))).status, 200)
})

Deno.test('Rate-Limit zählt auch verworfene Versuche (Honeypot)', async () => {
  const { handler } = setup()
  for (let i = 0; i < RATE_LIMIT; i++) await handler(post(validBody({ website: 'x' })))
  assert.assertEquals((await handler(post(validBody()))).status, 429)
})

Deno.test('ungültige Anfrage → 422 mit Feldfehlern', async () => {
  const { store, handler } = setup()
  const res = await handler(post(validBody({ email: 'kein-mail', pickup_date: '2026-10-12', consent_privacy: false })))
  assert.assertEquals(res.status, 422)
  const body = await res.json()
  assert.assert(body.fields.email)
  assert.assert(body.fields.pickup_date)
  assert.assert(body.fields.consent_privacy)
  assert.assertEquals(store.rows.length, 0)
})

Deno.test('Mail-Fehler: Anfrage bleibt gespeichert, Status failed', async () => {
  const { store, mailer, handler } = setup()
  mailer.fail = true
  assert.assertEquals((await handler(post(validBody()))).status, 200)
  assert.assertEquals(store.rows[0].notification_status, 'failed')
})

Deno.test('ohne Mail-Dienst: not_configured', async () => {
  const store = new FakeStore()
  const handler = createInquiryHandler({ store, mailer: null, hashIp: (ip) => Promise.resolve(ip), now: () => NOW, log: () => {} })
  assert.assertEquals((await handler(post(validBody()))).status, 200)
  assert.assertEquals(store.rows[0].notification_status, 'not_configured')
})

Deno.test('Kundenbestätigung nur mit Flag; im Testmodus an die Testadresse', async () => {
  const { store, mailer, handler } = setup()
  store.settings = { ...store.settings, notifyAddress: 'betrieb@example.com', customerConfirmation: true }
  await handler(post(validBody()))
  assert.assertEquals(mailer.sent.map((m) => m.to[0]), ['betrieb@example.com', 'test@example.com'])
})

Deno.test('ungültiges JSON → 400, falsche Methode → 405', async () => {
  const { handler } = setup()
  const bad = new Request('http://localhost/', { method: 'POST', body: '{' })
  assert.assertEquals((await handler(bad)).status, 400)
  assert.assertEquals((await handler(new Request('http://localhost/', { method: 'GET' }))).status, 405)
})
