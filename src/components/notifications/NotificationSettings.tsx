import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { availableEvents, PUSH_EVENT_LABEL, toggleEvent, type NotificationConfig, type PushEvent } from '../../lib/push/events'
import {
  browserSubscription,
  disablePush,
  enablePush,
  loadDevice,
  loadNotificationConfig,
  loadVapidKey,
  pushAvailability,
  renameDevice,
  sendTestPush,
  setDeviceEvents,
  suggestDeviceLabel,
  type DeviceSubscription,
  type PushAvailability,
} from '../../lib/push/pushClient'
import { Button, ErrorList, Field, TextInput } from '../ui'

const HINT: Record<Exclude<PushAvailability, { ok: true }>['reason'], string> = {
  dev: 'Im Entwicklungsmodus nicht verfügbar (nur in der installierten bzw. ausgelieferten App).',
  'ios-not-installed':
    'Auf iPhone und iPad gehen Benachrichtigungen nur in der installierten App: in Safari „Teilen“ → „Zum Home-Bildschirm“, die App von dort öffnen und hier aktivieren (ab iOS/iPadOS 16.4).',
  unsupported: 'Dieser Browser unterstützt keine Push-Benachrichtigungen. Bitte aktuelles Chrome oder Safari verwenden.',
  denied:
    'Benachrichtigungen sind für diese App blockiert. Freigeben in den Browser- bzw. Geräteeinstellungen (Website-Einstellungen → Benachrichtigungen → Erlauben), dann diese Seite neu laden.',
  'not-configured': 'Push ist auf dem Server noch nicht eingerichtet (VAPID-Schlüssel fehlt). Bitte Admin fragen.',
}

export function NotificationSettings() {
  const { profile } = useAuth()
  const role = profile?.role ?? 'staff'
  const [availability, setAvailability] = useState<PushAvailability | null>(null)
  const [config, setConfig] = useState<NotificationConfig>({ events: {} })
  const [device, setDevice] = useState<DeviceSubscription | null>(null)
  const [label, setLabel] = useState(() => suggestDeviceLabel(navigator.userAgent, navigator.maxTouchPoints))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [vapid, cfg] = await Promise.all([loadVapidKey(), loadNotificationConfig()])
        const avail = pushAvailability(vapid)
        let row: DeviceSubscription | null = null
        if (avail.ok || (!avail.ok && avail.reason === 'denied')) {
          const sub = await browserSubscription()
          if (sub) row = await loadDevice(sub.endpoint)
        }
        if (cancelled) return
        setConfig(cfg)
        setAvailability(avail)
        setDevice(row)
        if (row?.device_label) setLabel(row.device_label)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const events = availableEvents(config, role)

  if (!availability) return <p className="text-sm text-muted">Lädt …</p>

  if (!availability.ok) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{HINT[availability.reason]}</p>
        <ErrorList errors={error ? [error] : []} />
      </div>
    )
  }

  if (!device || !device.active) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-subtle">
          {device && !device.active
            ? 'Dieses Gerät wurde von Benachrichtigungen abgemeldet. Hier wieder anmelden.'
            : 'Hinweise zu neuen Buchungen, Umbuchungen, Umsetzen, Ankunft, Abholung und Shuttle – auch wenn die App geschlossen ist.'}
        </p>
        <Field label="Gerätename">
          <TextInput value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Tablet Halle" />
        </Field>
        <ErrorList errors={error ? [error] : []} />
        <div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void run(async () => setDevice(await enablePush(label.trim() || 'Gerät')))}
          >
            {busy ? 'Wird aktiviert …' : 'Benachrichtigungen aktivieren'}
          </Button>
        </div>
      </div>
    )
  }

  function toggle(event: PushEvent, on: boolean) {
    if (!device) return
    const next = toggleEvent(device.events, event, on)
    setDevice({ ...device, events: next })
    void run(async () => setDevice(await setDeviceEvents(device.endpoint, next)))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Gerätename" className="min-w-0 flex-1">
          <TextInput value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        {label.trim() && label.trim() !== device.device_label && (
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await renameDevice(device.id, label.trim())
                setDevice({ ...device, device_label: label.trim() })
              })
            }
          >
            Speichern
          </Button>
        )}
      </div>

      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-medium text-subtle">Auf diesem Gerät benachrichtigen bei</legend>
        {events.length === 0 && <p className="text-sm text-muted">Für deine Rolle sind derzeit keine Ereignisse eingeschaltet.</p>}
        {events.map((event) => (
          <label key={event} className="touch-target flex cursor-pointer items-center gap-3 border-b border-line py-2 last:border-0">
            <input
              type="checkbox"
              className="size-5 accent-accent"
              checked={device.events.includes(event)}
              disabled={busy}
              onChange={(e) => toggle(event, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{PUSH_EVENT_LABEL[event].title}</span>
              <span className="block text-xs text-muted">{PUSH_EVENT_LABEL[event].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <ErrorList errors={error ? [error] : []} />
      {info && <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok-ink">{info}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await sendTestPush(device.endpoint)
              setInfo('Testbenachrichtigung ist unterwegs. Sie sollte in wenigen Sekunden erscheinen.')
            })
          }
        >
          Testbenachrichtigung senden
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await disablePush()
              setDevice(null)
            })
          }
        >
          Auf diesem Gerät abmelden
        </Button>
      </div>
    </div>
  )
}
