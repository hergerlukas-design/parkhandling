// Edge Function booking-ref: holt für Telefonbuchungen (source = 'manual') eine Buchungsnummer
// bei CarHandling (Edge Function next-booking-ref, gemeinsamer Zähler mit dem Rechner) und
// speichert sie als external_ref. Nur für angemeldete Mitarbeitende.
//
// Body: { booking_id } für eine Buchung oder { pending: true } für alle ohne Nummer.
// Secrets: CARHANDLING_REF_SECRET (Header x-ref-secret), optional CARHANDLING_REF_URL.
// Idempotent: CarHandling liefert für dieselbe Buchungs-ID immer dieselbe Nummer.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { refRequest, validRef } from './logic.ts'

const DEFAULT_URL = 'https://orqkeiveksshijktxepv.supabase.co/functions/v1/next-booking-ref'
const MAX_PER_CALL = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isStaff } = await userClient.rpc('is_staff')
  if (!isStaff) return json({ error: 'Kein Zugriff' }, 403)

  const secret = Deno.env.get('CARHANDLING_REF_SECRET')
  if (!secret) return json({ error: 'Nummernvergabe nicht eingerichtet' }, 503)

  const body = await req.json().catch(() => ({}))
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let q = admin
    .from('bookings')
    .select('id, start_at, tariff_code, return_mode')
    .eq('source', 'manual')
    .is('external_ref', null)
    .not('status', 'in', '(cancelled,completed)')
  if (typeof body.booking_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.booking_id)) q = q.eq('id', body.booking_id)
  else if (body.pending !== true) return json({ error: 'booking_id oder pending fehlt' }, 400)
  const { data: rows, error } = await q.order('start_at').limit(MAX_PER_CALL)
  if (error) return json({ error: 'Laden fehlgeschlagen' }, 500)

  const results: { id: string; booking_ref?: string; error?: string }[] = []
  for (const b of rows ?? []) {
    const r = refRequest(b)
    if ('error' in r) {
      results.push({ id: b.id, error: r.error })
      continue
    }
    try {
      const res = await fetch(Deno.env.get('CARHANDLING_REF_URL') ?? DEFAULT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ref-secret': secret },
        body: JSON.stringify(r),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !validRef(data.booking_ref)) {
        results.push({ id: b.id, error: `CarHandling antwortet ${res.status}` })
        continue
      }
      const { error: upErr } = await admin
        .from('bookings')
        .update({ external_ref: data.booking_ref })
        .eq('id', b.id)
        .is('external_ref', null)
      results.push(upErr ? { id: b.id, error: 'Speichern fehlgeschlagen' } : { id: b.id, booking_ref: data.booking_ref })
    } catch {
      results.push({ id: b.id, error: 'CarHandling nicht erreichbar' })
    }
  }
  return json({ results })
})
