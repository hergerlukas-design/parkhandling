import { useEffect, useState } from 'react'
import { formatDateTime } from '../../lib/format'
import {
  EVENT_ROLE_LABEL,
  EVENT_ROLES,
  LEAD_FIELDS,
  PUSH_EVENT_LABEL,
  PUSH_EVENTS,
  type EventRole,
  type NotificationConfig,
  type PushEvent,
} from '../../lib/push/events'
import {
  listDevices,
  loadNotificationConfig,
  recentNotifications,
  saveNotificationConfig,
  setDeviceActive,
  type DeviceSubscription,
  type NotificationLogEntry,
} from '../../lib/push/pushClient'
import { Button, ErrorList, TextInput } from '../ui'

const STATUS_LABEL: Record<NotificationLogEntry['status'], { text: string; className: string }> = {
  pending: { text: 'wartet', className: 'bg-chip text-subtle' },
  sending: { text: 'wird gesendet', className: 'bg-accent-soft text-accent-dark' },
  sent: { text: 'gesendet', className: 'bg-ok-soft text-ok-ink' },
  failed: { text: 'fehlgeschlagen', className: 'bg-danger-soft text-danger-ink' },
  skipped: { text: 'kein Empfänger', className: 'bg-chip text-muted' },
}

function eventLabel(event: string): string {
  return event === 'test' ? 'Test' : (PUSH_EVENT_LABEL[event as PushEvent]?.title ?? event)
}

/** Admin: Ereignisse global schalten, Empfänger und Vorlaufzeiten, Geräte, Protokoll. */
export function NotificationAdmin() {
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [dirty, setDirty] = useState(false)
  const [devices, setDevices] = useState<DeviceSubscription[]>([])
  const [log, setLog] = useState<NotificationLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const [cfg, devs, entries] = await Promise.all([loadNotificationConfig(), listDevices(), recentNotifications(50)])
      setConfig(cfg)
      setDevices(devs)
      setLog(entries)
      setDirty(false)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  function patchEvent(event: PushEvent, patch: { enabled?: boolean; roles?: EventRole[] }) {
    if (!config) return
    setConfig({ ...config, events: { ...config.events, [event]: { ...config.events[event], ...patch } } })
    setDirty(true)
  }

  async function save() {
    if (!config) return
    setBusy(true)
    try {
      await saveNotificationConfig(config)
      setDirty(false)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleDevice(d: DeviceSubscription) {
    try {
      await setDeviceActive(d.id, !d.active)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!config) return <p className="text-sm text-muted">{error ?? 'Lädt …'}</p>

  return (
    <div className="flex flex-col gap-5">
      <ErrorList errors={error ? [error] : []} />

      <section>
        <h3 className="mb-1 text-sm font-semibold">Ereignisse</h3>
        <p className="mb-2 text-xs text-muted">
          Ausgeschaltete Ereignisse werden an kein Gerät gesendet. Empfänger mehrfach wählbar:
          „Personal“ schließt Admins ein, „Fahrer“ erreicht auch reine Fahrer. Jedes Gerät kann einzelne
          Ereignisse zusätzlich abbestellen.
        </p>
        <ul className="divide-y divide-line">
          {PUSH_EVENTS.map((event) => {
            const cfg = config.events[event] ?? {}
            const enabled = cfg.enabled !== false
            const roles: EventRole[] = cfg.roles?.length ? cfg.roles : ['staff']
            return (
              <li key={event} className="flex flex-wrap items-center gap-3 py-2">
                <label className="touch-target flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-accent"
                    checked={enabled}
                    onChange={(e) => patchEvent(event, { enabled: e.target.checked })}
                  />
                  <span className="text-sm font-medium">{PUSH_EVENT_LABEL[event].title}</span>
                </label>
<div className="flex flex-wrap gap-1.5" role="group" aria-label={`Empfänger ${PUSH_EVENT_LABEL[event].title}`}>
                  {EVENT_ROLES.map((role) => {
                    const on = roles.includes(role)
                    return (
                      <button key={role} type="button" aria-pressed={on} disabled={!enabled}
                        onClick={() => {
                          const next = EVENT_ROLES.filter((r) => (r === role ? !on : roles.includes(r)))
                          if (next.length) patchEvent(event, { roles: next })
                        }}
                        className={`touch-target rounded-full px-3 text-xs font-semibold disabled:opacity-50 ${on ? 'bg-ink text-white' : 'bg-chip text-subtle hover:bg-line'}`}>
                        {EVENT_ROLE_LABEL[role]}
                      </button>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Vorlauf in Minuten</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {LEAD_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs font-medium text-subtle">
              {f.label}
              <TextInput
                type="number"
                inputMode="numeric"
                min={0}
                max={1440}
                value={config[f.key] ?? f.fallback}
                onChange={(e) => {
                  const value = Math.max(0, Math.min(1440, Math.round(Number(e.target.value) || 0)))
                  setConfig({ ...config, [f.key]: value })
                  setDirty(true)
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? 'Speichert …' : 'Einstellungen speichern'}
        </Button>
        {dirty && <Button onClick={() => void reload()}>Verwerfen</Button>}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Angemeldete Geräte ({devices.filter((d) => d.active).length} aktiv)</h3>
        {devices.length === 0 ? (
          <p className="text-sm text-muted">Noch kein Gerät angemeldet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${d.active ? '' : 'text-muted line-through'}`}>
                    {d.device_label || 'Gerät'} · {d.profiles?.display_name ?? '–'}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {d.last_success_at ? `zuletzt zugestellt ${formatDateTime(d.last_success_at)}` : 'noch nichts zugestellt'}
                    {d.last_error ? ` · Fehler: ${d.last_error}` : ''} · {d.events.length} Ereignisse
                  </p>
                </div>
                <Button onClick={() => void toggleDevice(d)}>{d.active ? 'Abmelden' : 'Aktivieren'}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Letzte Benachrichtigungen</h3>
          <Button onClick={() => void reload()}>Aktualisieren</Button>
        </div>
        {log.length === 0 ? (
          <p className="text-sm text-muted">Noch keine Benachrichtigungen.</p>
        ) : (
          <ul className="divide-y divide-line">
            {log.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{n.payload.title ?? eventLabel(n.event)}</p>
                  <p className="truncate text-xs text-muted">
                    {formatDateTime(n.created_at)} · {eventLabel(n.event)}
                    {n.sent_count > 0 ? ` · ${n.sent_count} Gerät${n.sent_count === 1 ? '' : 'e'}` : ''}
                    {n.error ? ` · ${n.error}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_LABEL[n.status].className}`}>
                  {STATUS_LABEL[n.status].text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
