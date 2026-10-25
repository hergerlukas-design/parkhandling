import { base64UrlDecode } from '../../../supabase/functions/_shared/webpush.ts'
import { getDeviceId } from '../deviceId'
import { supabase } from '../supabase'
import type { NotificationConfig, PushEvent } from './events'

export interface DeviceSubscription {
  id: string
  user_id: string
  device_label: string
  endpoint: string
  events: PushEvent[]
  active: boolean
  last_success_at: string | null
  last_error: string | null
  failure_count: number
  user_agent: string | null
  created_at: string
  profiles?: { display_name: string; role: string } | null
}

export interface NotificationLogEntry {
  id: string
  event: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
  payload: { title?: string; body?: string }
  sent_count: number
  error: string | null
  created_at: string
}

export type PushAvailability =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'ios-not-installed' | 'denied' | 'not-configured' | 'dev' }

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

/** iPhone/iPad (auch iPadOS, das sich als Mac ausgibt). */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as NavigatorWithStandalone).standalone === true
  )
}

/** Kann dieses Gerät jetzt Push-Benachrichtigungen bekommen? */
export function pushAvailability(vapidKey: string | null): PushAvailability {
  if (!import.meta.env.PROD) return { ok: false, reason: 'dev' }
  const apple = isAppleMobile(navigator.userAgent, navigator.maxTouchPoints)
  // iOS/iPadOS kennt Web Push nur in der installierten App (Home-Bildschirm, ab 16.4)
  if (apple && !isStandalone()) return { ok: false, reason: 'ios-not-installed' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: 'unsupported' }
  }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  if (!vapidKey) return { ok: false, reason: 'not-configured' }
  return { ok: true }
}

/** Vorschlag für den Gerätenamen, z. B. „iPad“ oder „Android-Tablet“. */
export function suggestDeviceLabel(userAgent: string, maxTouchPoints: number): string {
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/.test(userAgent)) return 'iPhone'
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android-Smartphone' : 'Android-Tablet'
  if (/Windows/.test(userAgent)) return 'Windows-PC'
  if (/Macintosh/.test(userAgent)) return 'Mac'
  return 'Gerät'
}

function client() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

let vapidCache: string | null | undefined

export async function loadVapidKey(): Promise<string | null> {
  if (vapidCache !== undefined) return vapidCache
  if (!supabase) return null
  const { data } = await supabase.from('settings').select('value').eq('key', 'push_vapid_public_key').maybeSingle()
  const value = typeof data?.value === 'string' ? data.value.trim() : ''
  vapidCache = value || null
  return vapidCache
}

function keysOf(sub: PushSubscription): { p256dh: string; auth: string } {
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!p256dh || !auth) throw new Error('Push-Abo ohne Schlüssel')
  return { p256dh, auth }
}

function sameKey(sub: PushSubscription, vapidKey: string): boolean {
  const current = sub.options.applicationServerKey
  if (!current) return true
  const a = new Uint8Array(current)
  const b = base64UrlDecode(vapidKey)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

async function save(sub: PushSubscription, label: string | null, events?: PushEvent[]): Promise<DeviceSubscription> {
  const { p256dh, auth } = keysOf(sub)
  const { data, error } = await client().rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_device_label: label ?? '',
    p_device_id: getDeviceId(),
    p_user_agent: navigator.userAgent.slice(0, 500),
    p_events: events ?? null,
  })
  if (error) throw new Error('Gerät konnte nicht angemeldet werden')
  return data as DeviceSubscription
}

/** Push-Abo dieses Geräts (Browser) – null, wenn keins besteht. */
export async function browserSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Eintrag dieses Geräts in der Datenbank. */
export async function loadDevice(endpoint: string): Promise<DeviceSubscription | null> {
  const { data } = await client()
    .from('push_subscriptions')
    .select('*')
    .eq('endpoint', endpoint)
    .maybeSingle<DeviceSubscription>()
  return data ?? null
}

/** Fragt die Berechtigung an (nur nach Tippen aufrufen) und meldet das Gerät an. */
export async function enablePush(label: string): Promise<DeviceSubscription> {
  const vapidKey = await loadVapidKey()
  if (!vapidKey) throw new Error('Push ist auf dem Server noch nicht eingerichtet')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Benachrichtigungen wurden abgelehnt. Bitte in den Browser- bzw. App-Einstellungen erlauben.'
        : 'Benachrichtigungen wurden nicht erlaubt.',
    )
  }
  const reg = await registration()
  if (!reg) throw new Error('Service Worker nicht bereit – App einmal neu laden')
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, vapidKey)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlDecode(vapidKey) })
  return save(sub, label)
}

/** Meldet das Gerät ab (Browser und Datenbank). */
export async function disablePush(): Promise<void> {
  const sub = await browserSubscription()
  if (!sub) return
  await client().rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
  await sub.unsubscribe().catch(() => undefined)
}

/**
 * Beim App-Start: bestehendes Abo mit dem angemeldeten Konto abgleichen (Schlüssel aktuell halten,
 * nach Kontowechsel übernehmen, nach neuem VAPID-Schlüssel neu abonnieren). Fragt nie nach Berechtigung.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!supabase || !import.meta.env.PROD || !('PushManager' in window) || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  const reg = await registration()
  let sub = await reg?.pushManager.getSubscription()
  if (!reg || !sub) return
  const vapidKey = await loadVapidKey()
  if (!vapidKey) return
  if (!sameKey(sub, vapidKey)) {
    await sub.unsubscribe().catch(() => undefined)
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlDecode(vapidKey) })
  }
  await save(sub, null)
}

export async function setDeviceEvents(endpoint: string, events: PushEvent[]): Promise<DeviceSubscription> {
  const { data, error } = await client().rpc('set_push_events', { p_endpoint: endpoint, p_events: events })
  if (error) throw new Error('Auswahl konnte nicht gespeichert werden')
  return data as DeviceSubscription
}

export async function renameDevice(id: string, label: string): Promise<void> {
  const { error } = await client().from('push_subscriptions').update({ device_label: label.slice(0, 60) }).eq('id', id)
  if (error) throw new Error('Gerätename konnte nicht gespeichert werden')
}

export async function sendTestPush(endpoint: string): Promise<void> {
  const { error } = await client().rpc('send_test_push', { p_endpoint: endpoint })
  if (error) throw new Error(error.message.includes('nicht für Benachrichtigungen') ? error.message : 'Test konnte nicht gesendet werden')
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function loadNotificationConfig(): Promise<NotificationConfig> {
  const { data, error } = await client().from('settings').select('value').eq('key', 'notifications').maybeSingle()
  if (error) throw new Error('Einstellungen konnten nicht geladen werden')
  return (data?.value as NotificationConfig | undefined) ?? { events: {} }
}

export async function saveNotificationConfig(config: NotificationConfig): Promise<void> {
  const { error } = await client().from('settings').update({ value: config }).eq('key', 'notifications')
  if (error) throw new Error('Einstellungen konnten nicht gespeichert werden')
}

export async function listDevices(): Promise<DeviceSubscription[]> {
  const { data, error } = await client()
    .from('push_subscriptions')
    .select('*, profiles(display_name, role)')
    .order('active', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error('Geräte konnten nicht geladen werden')
  return (data ?? []) as DeviceSubscription[]
}

export async function setDeviceActive(id: string, active: boolean): Promise<void> {
  const patch = active ? { active, failure_count: 0, last_error: null } : { active }
  const { error } = await client().from('push_subscriptions').update(patch).eq('id', id)
  if (error) throw new Error('Gerät konnte nicht geändert werden')
}

export async function recentNotifications(limit = 50): Promise<NotificationLogEntry[]> {
  const { data, error } = await client()
    .from('notifications')
    .select('id, event, status, payload, sent_count, error, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error('Protokoll konnte nicht geladen werden')
  return (data ?? []) as NotificationLogEntry[]
}
