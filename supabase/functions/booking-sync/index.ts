// Edge Function booking-sync: übernimmt Buchungen aus dem neuen CarHandling-Buchungsbackend
// (Rechner mit Stripe) ins Dashboard. Das andere Backend bleibt führend; hier entsteht eine Kopie,
// die bei jeder Änderung (Zahlung, Umbuchung, Storno) aktualisiert wird.
//
// Deploy OHNE JWT-Prüfung (Aufrufer ist ein Database Webhook des anderen Projekts):
//   supabase functions deploy booking-sync --no-verify-jwt
// Absicherung: Header `x-sync-secret` muss dem Secret BOOKING_SYNC_SECRET entsprechen (mind. 24 Zeichen).
//
// Body: Hülle eines Supabase Database Webhooks { type, table, record, old_record }
//       oder direkt { booking: {...} }. Anleitung: docs/carhandling-sync.md
import { createClient } from 'npm:@supabase/supabase-js@2'
import { json } from '../_shared/cors.ts'
import { mapRecord, secretMatches, SYNC_SOURCE, unwrapPayload } from './logic.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405)
  if (!secretMatches(req.headers.get('x-sync-secret'), Deno.env.get('BOOKING_SYNC_SECRET'))) {
    return json({ error: 'Nicht berechtigt' }, 401)
  }

  const body = await req.json().catch(() => null)
  const unwrapped = unwrapPayload(body)
  const input = 'error' in unwrapped
    ? {
      source: SYNC_SOURCE,
      external_ref: null,
      event: 'new',
      booking: {},
      tariff_code: null,
      raw: body ?? {},
      error: unwrapped.error,
    }
    : mapRecord(unwrapped.record, unwrapped.deleted)

  // Auch fehlerhafte Datensätze gehen an die Datenbank: sie landen in der Prüfliste der App
  const { data, error } = await admin.rpc('sync_external_booking', { p: input })
  if (error) {
    console.error('booking-sync: rpc failed', input.external_ref, error.message)
    return json({ error: 'Speichern fehlgeschlagen' }, 500)
  }
  const result = data as { status: string; booking_id: string | null; error: string | null }
  // 422 bei Daten, die wir nicht übernehmen konnten (Webhook-Protokoll des Absenders zeigt es an)
  return json(result, result.status === 'failed' ? 422 : 200)
})
