// Edge Function carhandling-checkin: meldet Annahme (Annahmeprotokoll abgeschlossen) und Rückgabe
// (Übergabeprotokoll abgeschlossen) von Rechner-Buchungen an CarHandling (Edge Function checkin-status),
// damit Ticket und Check-in dort denselben Stand zeigen. Nur für angemeldete Mitarbeitende.
//
// Body: { booking_id } für eine Buchung oder { pending: true } für alle ausstehenden Meldungen.
// Secrets: CARHANDLING_REF_SECRET (Header x-ref-secret, wie booking-ref), optional CARHANDLING_CHECKIN_URL.
// Idempotent: Gemeldet wird nur, was laut carhandling_checked_in_at/_out_at noch fehlt; CarHandling
// behandelt wiederholte Meldungen ebenfalls als erledigt.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { pendingRequests, stateFromResponse, type CheckinBooking } from './logic.ts'

const DEFAULT_URL = 'https://orqkeiveksshijktxepv.supabase.co/functions/v1/checkin-status'
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
  if (!secret) return json({ error: 'Meldung an CarHandling nicht eingerichtet' }, 503)

  const body = await req.json().catch(() => ({}))
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let q = admin
    .from('bookings')
    .select('id, external_ref, status, carhandling_checked_in_at, carhandling_checked_out_at, protocols(type, status, finalized_at)')
    .eq('source', 'carhandling')
    .not('external_ref', 'is', null)
    .neq('status', 'cancelled')
  if (typeof body.booking_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.booking_id)) q = q.eq('id', body.booking_id)
  else if (body.pending === true) q = q.or('carhandling_checked_in_at.is.null,carhandling_checked_out_at.is.null')
  else return json({ error: 'booking_id oder pending fehlt' }, 400)
  const { data: rows, error } = await q.order('start_at', { ascending: false }).limit(200)
  if (error) return json({ error: 'Laden fehlgeschlagen' }, 500)

  const requests = (rows as CheckinBooking[] ?? [])
    .flatMap((b) => pendingRequests(b).map((r) => ({ id: b.id, r })))
    .slice(0, MAX_PER_CALL)

  const results: { id: string; op: string; ok: boolean; error?: string }[] = []
  for (const { id, r } of requests) {
    try {
      const res = await fetch(Deno.env.get('CARHANDLING_CHECKIN_URL') ?? DEFAULT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ref-secret': secret },
        body: JSON.stringify(r),
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        results.push({ id, op: r.op, ok: false, error: `CarHandling antwortet ${res.status}` })
        continue
      }
      const { error: upErr } = await admin.from('bookings').update(stateFromResponse(r, data)).eq('id', id)
      results.push(upErr ? { id, op: r.op, ok: false, error: 'Speichern fehlgeschlagen' } : { id, op: r.op, ok: true })
    } catch {
      results.push({ id, op: r.op, ok: false, error: 'CarHandling nicht erreichbar' })
    }
  }
  return json({ results })
})
