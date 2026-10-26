// Edge Function charging-sync
// Fragt die Kempower-ChargEye-API nach den Ladevorgängen offener Sitzungen ab (Laden erfassen, 0.29.0).
//
//  * Aufruf nur intern: per pg_net aus der Datenbank (charging_dispatch) mit Header x-charging-secret.
//    Kein Aufruf aus dem Browser.
//  * Offene Sitzungen liefert charging_open_sessions(), jede Transaktion geht über charging_apply()
//    zurück, der Gesamtstatus über charging_sync_finished(). Logik: ../_shared/kempower.ts
//
// Secrets: standardmäßig aus der Datenbank (charging_sync_config(): Vault kempower_refresh_token und
// charging_sync_secret). Optional überschreiben Function-Secrets KEMPOWER_REFRESH_TOKEN und
// CHARGING_SYNC_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { runSync, type FetchFn, type SyncConfig } from '../_shared/kempower.ts'

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return respond({ error: 'Methode nicht erlaubt' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: cfgData, error: cfgError } = await db.rpc('charging_sync_config')
  if (cfgError) return respond({ error: `charging_sync_config: ${cfgError.message}` }, 500)
  const cfg = (cfgData ?? {}) as SyncConfig & { secret?: string }

  const secret = Deno.env.get('CHARGING_SYNC_SECRET') || cfg.secret || ''
  if (!secret || !safeEqual(req.headers.get('x-charging-secret') ?? '', secret)) {
    return respond({ error: 'Nicht berechtigt' }, 401)
  }

  const rpc = async (name: string, args?: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args ?? {})
    if (error) throw new Error(`${name}: ${error.message}`)
    return data
  }

  const fetchWithTimeout: FetchFn = async (url, init) => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    return res
  }

  try {
    const result = await runSync({
      fetch: fetchWithTimeout,
      rpc,
      config: {
        settings: cfg.settings ?? {},
        refresh_token: Deno.env.get('KEMPOWER_REFRESH_TOKEN') || cfg.refresh_token || '',
        access_token: cfg.access_token ?? null,
        test_requested: !!cfg.test_requested,
      },
    })
    return respond(result, result.ok ? 200 : 502)
  } catch (e) {
    const message = String((e as Error).message ?? e).slice(0, 300)
    await db.rpc('charging_sync_finished', { p_ok: false, p_error: message, p_stations: null })
    return respond({ ok: false, error: message }, 500)
  }
})
