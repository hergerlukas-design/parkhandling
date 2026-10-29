// Edge Function review-notes: Kommentare zur Vorschau der Landingpage.
// Deploy OHNE JWT-Prüfung (die Vorschau sendet anonym, geschützt wird über REVIEW_TOKEN):
//   supabase functions deploy review-notes --no-verify-jwt
//
// Aktionen (POST, JSON mit "action" und "token"):
//  * "list"   → alle Notizen, neueste zuerst
//  * "add"    → Notiz zu einem Abschnitt (page, section, body, author)
//  * "status" → Notiz als offen oder erledigt markieren (id, status)
//
// Secrets: REVIEW_TOKEN (langes Zufallswort, nur an Prüfer weitergeben)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

/** Vergleich ohne frühen Abbruch, damit die Laufzeit nichts über das Token verrät */
function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

interface Body {
  action?: string
  token?: unknown
  page?: unknown
  section?: unknown
  body?: unknown
  author?: unknown
  id?: unknown
  status?: unknown
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

  const expected = Deno.env.get('REVIEW_TOKEN')
  if (!expected) return json({ error: 'Der Review-Modus ist nicht eingerichtet.' }, 503)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Ungültiges JSON' }, 400)
  }
  if (!tokenMatches(body.token, expected)) return json({ error: 'Kein Zugriff.' }, 403)

  try {
    if (body.action === 'list') {
      const { data, error } = await admin
        .from('review_notes')
        .select('id, page, section, body, author, status, created_at')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return json({ notes: data ?? [] })
    }

    if (body.action === 'add') {
      const page = clean(body.page, 200)
      const section = clean(body.section, 100)
      const text = clean(body.body, 1000)
      const author = clean(body.author, 60) || null
      if (!page || !section) return json({ error: 'Abschnitt fehlt.' }, 422)
      if (!text) return json({ error: 'Bitte einen Kommentar schreiben.' }, 422)
      const { data, error } = await admin
        .from('review_notes')
        .insert({ page, section, body: text, author })
        .select('id, page, section, body, author, status, created_at')
        .single()
      if (error) throw error
      return json({ note: data })
    }

    if (body.action === 'status') {
      const id = clean(body.id, 40)
      const status = body.status === 'erledigt' ? 'erledigt' : 'offen'
      if (!id) return json({ error: 'Notiz fehlt.' }, 422)
      const { error } = await admin.from('review_notes').update({ status }).eq('id', id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'Unbekannte Aktion' }, 400)
  } catch (err) {
    console.error('review-notes failed', err instanceof Error ? err.message : err)
    return json({ error: 'Ein Fehler ist aufgetreten.' }, 500)
  }
})
