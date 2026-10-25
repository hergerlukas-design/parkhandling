// Edge Function user-invite
// Legt ein internes Konto per Einladung an (Supabase Auth inviteUserByEmail) und
// setzt Rollen, Anzeigename und Freischaltung im Profil. Selbstregistrierung ist deaktiviert.
//
// Berechtigung: nur aktive Admins (serverseitig über RLS-Funktion is_admin geprüft).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const ROLES = ['admin', 'staff', 'driver'] as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface InviteRequest {
  email?: string
  /** veraltet: eine Rolle */
  role?: string
  /** Rollen, beliebig kombinierbar */
  roles?: string[]
  display_name?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const appUrl = Deno.env.get('APP_URL') ?? req.headers.get('Origin') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Nicht angemeldet' }, 401)
  const { data: isAdmin } = await userClient.rpc('is_admin')
  if (!isAdmin) return json({ error: 'Nur Admins können Konten einladen' }, 403)

  let body: InviteRequest
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Ungültiges JSON' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const requested = Array.isArray(body.roles) && body.roles.length ? body.roles : [body.role ?? 'staff']
  const roles = ROLES.filter((r) => requested.includes(r))
  const displayName = (body.display_name ?? '').trim().slice(0, 100)
  if (!EMAIL.test(email) || email.length > 254) return json({ error: 'E-Mail-Adresse ungültig' }, 400)
  if (!roles.length || roles.length !== new Set(requested).size) return json({ error: 'Rolle ungültig' }, 400)
  const role = roles.includes('admin') ? 'admin' : 'staff'

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { name: displayName },
    redirectTo: appUrl ? `${appUrl.replace(/\/$/, '')}/passwort` : undefined,
  })
  if (inviteError) {
    if (/already|registered|exists/i.test(inviteError.message)) {
      return json({ error: 'Für diese E-Mail-Adresse existiert bereits ein Konto' }, 409)
    }
    return json({ error: 'Einladung fehlgeschlagen' }, 500)
  }

  const now = new Date().toISOString()
  const { error: profileError } = await admin.from('profiles').upsert(
    {
      id: invited.user.id,
      email,
      display_name: displayName || email,
      role,
      roles,
      active: true,
      must_change_password: true,
      invited_at: now,
      updated_at: now,
    },
    { onConflict: 'id' },
  )
  if (profileError) return json({ error: 'Profil konnte nicht angelegt werden' }, 500)

  return json({ ok: true, id: invited.user.id, email, role, roles })
})
