import { getDeviceId } from './deviceId'
import { supabase } from './supabase'
import { APP_VERSION } from './version'

/**
 * Meldet unbehandelte Fehler an public.client_errors (nur angemeldet, Admins lesen in den Einstellungen).
 * Kein externer Dienst: Daten bleiben in der eigenen Supabase-Datenbank.
 */

export type ClientErrorKind = 'error' | 'unhandledrejection' | 'react' | 'manual'

export interface ClientErrorReport {
  kind: ClientErrorKind
  message: string
  stack: string | null
  route: string
}

/** Geräuschquellen ohne Aussagekraft (Browser-Erweiterungen, Netzabbrüche offline, ResizeObserver). */
const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /AbortError|The operation was aborted/i,
]

/** Signed URLs, Tokens und E-Mail-Adressen aus Meldungen entfernen, bevor sie gespeichert werden. */
export function sanitize(text: string): string {
  return text
    .replace(/([?&](token|apikey|access_token|refresh_token|code)=)[^&\s"')]+/gi, '$1…')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, 'eyJ…')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '…@…')
}

export function toReport(kind: ClientErrorKind, reason: unknown, route: string): ClientErrorReport | null {
  const error = reason instanceof Error ? reason : null
  const raw = error ? `${error.name}: ${error.message}` : typeof reason === 'string' ? reason : safeJson(reason)
  if (!raw || IGNORE.some((re) => re.test(raw))) return null
  if (!navigator.onLine && /fetch|network|load failed/i.test(raw)) return null
  return {
    kind,
    message: sanitize(raw).slice(0, 1000),
    stack: error?.stack ? sanitize(error.stack).slice(0, 4000) : null,
    route: route.split('?')[0].slice(0, 200),
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 1000) ?? String(value)
  } catch {
    return String(value)
  }
}

const MAX_PER_MINUTE = 10
let sentThisMinute = 0
let minuteStart = 0
const recent = new Map<string, number>()

export async function reportError(kind: ClientErrorKind, reason: unknown): Promise<void> {
  try {
    if (!supabase) return
    const report = toReport(kind, reason, location.pathname)
    if (!report) return

    const now = Date.now()
    if (now - minuteStart > 60_000) {
      minuteStart = now
      sentThisMinute = 0
    }
    // Derselbe Fehler in Schleife: nur einmal je 30 Sekunden senden (Server zählt Wiederholungen ohnehin)
    const key = `${report.kind}|${report.message}`
    if ((recent.get(key) ?? 0) > now - 30_000 || sentThisMinute >= MAX_PER_MINUTE) return
    recent.set(key, now)
    sentThisMinute++

    await supabase.rpc('log_client_error', {
      p_kind: report.kind,
      p_message: report.message,
      p_stack: report.stack,
      p_route: report.route,
      p_app_version: APP_VERSION,
      p_device_id: getDeviceId(),
      p_user_agent: navigator.userAgent.slice(0, 300),
    })
  } catch {
    // Fehlermeldung darf nie selbst einen Fehler auslösen
  }
}

let started = false

export function startErrorReporting(): void {
  if (started) return
  started = true
  window.addEventListener('error', (e) => void reportError('error', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => void reportError('unhandledrejection', e.reason))
}

// ---------------------------------------------------------------------------
// Ansicht für Admins (Einstellungen → Fehlerprotokoll)
// ---------------------------------------------------------------------------

export interface ClientErrorRow {
  id: string
  created_at: string
  last_seen_at: string
  occurrences: number
  kind: ClientErrorKind
  message: string
  stack: string | null
  route: string | null
  app_version: string | null
  user_agent: string | null
  profile: { display_name: string } | null
}

export async function listClientErrors(limit = 30): Promise<ClientErrorRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('client_errors')
    .select('id, created_at, last_seen_at, occurrences, kind, message, stack, route, app_version, user_agent, profile:profiles(display_name)')
    .order('last_seen_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error('Fehlerprotokoll konnte nicht geladen werden')
  return (data ?? []) as unknown as ClientErrorRow[]
}

export async function clearClientErrors(ids: string[]): Promise<void> {
  if (!supabase || ids.length === 0) return
  const { error } = await supabase.from('client_errors').delete().in('id', ids)
  if (error) throw new Error('Einträge konnten nicht gelöscht werden')
}
