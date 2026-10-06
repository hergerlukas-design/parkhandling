import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { formFromBooking } from '../booking-adapters'
import { BookingFormDialog } from '../components/bookings/BookingFormDialog'
import { MoveDialog } from '../components/siteplan/MoveDialog'
import { TaskSheet } from '../components/tasks/TaskSheet'
import { Icon } from '../components/Icon'
import { Button, Dialog, PaymentBadge, StatusBadge } from '../components/ui'
import { cancelBooking, getBookingDetail, type BookingDetail } from '../lib/bookings'
import { DUE_STYLE, dueCategory, formatPickup } from '../lib/due'
import { formatDate, formatDateTime, formatMoney } from '../lib/format'
import { listProtocols, type ProtocolRow } from '../lib/protocols'
import {
  AREA_LABEL,
  BOOKING_STATUS_LABEL,
  FUEL_TYPE_LABEL,
  PARKING_TYPE_LABEL,
  RETURN_MODE_LABEL,
  type LocationArea,
  type Task,
} from '../types/domain'

const FIELD_LABEL: Record<string, string> = {
  customer_name: 'Kunde',
  company: 'Firma',
  customer_email: 'E-Mail',
  customer_phone: 'Telefon',
  plate: 'Kennzeichen',
  vehicle_model: 'Fahrzeug',
  fuel_type: 'Antrieb',
  persons: 'Personen',
  start_at: 'Anreise',
  end_at: 'Abholung',
  parking_type: 'Parkplatz',
  return_mode: 'Rückgabe',
  status: 'Status',
  notes: 'Notizen',
  external_ref: 'Buchungs-Nr.',
  price_total: 'Preis',
  payment_status: 'Zahlung',
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manuell angelegt',
  excel: 'Excel-Import',
  csv: 'CSV-Import',
  demo: 'Demo-Daten',
}

function fmtValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '–'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v)
  if (key === 'status') return BOOKING_STATUS_LABEL[v as keyof typeof BOOKING_STATUS_LABEL] ?? String(v)
  if (key === 'price_total') return formatMoney(Number(v))
  return String(v)
}

function describeChange(key: string, value: unknown): string {
  const v = value as { old?: unknown; new?: unknown; code?: string }
  if (key === 'service_added') return `Leistung nachgebucht: ${v.code}`
  if (key === 'service_cancelled') return `Leistung storniert: ${v.code}`
  return `${FIELD_LABEL[key] ?? key}: ${fmtValue(key, v.old)} → ${fmtValue(key, v.new)}`
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside && <span className="text-sm text-muted">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <dt className="shrink-0 text-subtle">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const done = task.status === 'done'
  const steps = task.checklist ?? []
  const stepsDone = steps.filter((s) => s.done).length
  return (
    <li>
      <button type="button" onClick={() => onOpen(task.id)}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${done ? 'bg-ground' : 'bg-warn-soft/50'}`}>
      <span
        className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${
          done ? 'text-ok' : task.status === 'in_progress' ? 'border-2 border-warn' : 'border-2 border-warn/70'
        }`}
        aria-hidden="true"
      >
        {done ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{task.title}</span>
        <span className="block text-xs text-subtle">
          {done
            ? `erledigt ${task.done_at ? formatDate(task.done_at).slice(0, 6) : ''}`
            : `${task.status === 'in_progress' ? 'in Arbeit' : 'offen'}${task.due_at ? ` · fällig bis ${formatPickup(task.due_at)}` : ''}`}
        </span>
      </span>
      {steps.length > 0 && <span className="text-xs text-muted">{stepsDone}/{steps.length}</span>}
      </button>
    </li>
  )
}

export function VehicleDetailPage() {
  const { id } = useParams()
  const [data, setData] = useState<BookingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [move, setMove] = useState<'checkout' | 'relocate' | null>(null)
  const [moveNotice, setMoveNotice] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [protocols, setProtocols] = useState<ProtocolRow[]>([])

  const load = useCallback(() => {
    if (!id) return
    getBookingDetail(id).then(setData).catch((e: Error) => setError(e.message))
    listProtocols(id).then(setProtocols).catch(() => undefined)
  }, [id])

  useEffect(load, [load])

  if (error) return <p className="p-6 text-sm text-danger">{error}</p>
  if (!data) return <p className="p-6 text-sm text-muted">Lädt …</p>

  const { booking: b, services, tasks, history, movements, key } = data
  const relevant = tasks.filter((t) => t.status !== 'cancelled' && t.type !== 'relocate')
  const done = relevant.filter((t) => t.status === 'done').length
  const due = dueCategory(b.end_at)
  const closed = b.status === 'cancelled' || b.status === 'completed'

  const timeline = [
    ...protocols
      .filter((p) => p.status === 'final' && p.finalized_at)
      .map((p) => ({
        at: p.finalized_at!,
        text: `${p.type === 'intake' ? 'Annahmeprotokoll' : 'Übergabeprotokoll'} unterschrieben${p.inspector_name ? ` · ${p.inspector_name}` : ''}`,
        tone: 'bg-ok',
      })),
    ...movements.map((m) => ({
      at: m.moved_at,
      text: !m.to
        ? `Übergeben (${m.from?.code ?? '–'})`
        : m.from
          ? `Umgesetzt: ${m.from.code} → ${m.to.code}${m.reason ? ` · ${m.reason}` : ''}`
          : `Eingelagert ${m.to.code}${m.reason ? ` · ${m.reason}` : ''}`,
      tone: 'bg-accent',
    })),
    ...history.flatMap((h) =>
      Object.entries(h.changed_fields).map(([k, v]) => ({
        at: h.changed_at,
        text: `${describeChange(k, v)} · ${SOURCE_LABEL[h.source] ?? h.source}`,
        tone: k === 'status' ? 'bg-ok' : 'bg-warn',
      })),
    ),
    { at: b.received_at ?? b.created_at, text: `Buchung eingegangen · ${SOURCE_LABEL[b.source] ?? b.source}`, tone: 'bg-muted' },
  ].sort((x, y) => y.at.localeCompare(x.at))

  async function doCancel() {
    setBusy(true)
    try {
      await cancelBooking(b.id)
      setConfirmCancel(false)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to="/fahrzeuge" className="touch-target inline-flex items-center gap-1 text-sm text-subtle">
          <Icon name="back" className="size-5" />
          Fahrzeuge
        </Link>
        <h1 className="font-mono text-2xl font-bold">{b.plate}</h1>
        <span className="text-sm text-subtle">
          {[b.vehicle_model, b.external_ref && `Buchung ${b.external_ref}`].filter(Boolean).join(' · ')}
        </span>
        <StatusBadge status={b.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {!closed && <Button onClick={() => setConfirmCancel(true)}>Stornieren</Button>}
          {!closed && (
            <Button variant="primary" onClick={() => setEditing(true)}>
              Bearbeiten
            </Button>
          )}
        </div>
      </header>

      {b.notes?.startsWith('⚠') && (
        <p className="rounded-xl border border-warn bg-warn-soft px-4 py-2 text-sm text-warn-ink">
          Kennzeichen aus dem Import nicht eindeutig – bitte prüfen und über „Bearbeiten“ korrigieren.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
          <Card title="Buchung">
            <dl>
              <Row label="Kunde">{b.customer_name}</Row>
              {b.company && b.company !== b.customer_name && <Row label="Firma">{b.company}</Row>}
              <Row label="Kontakt">{[b.customer_email, b.customer_phone].filter(Boolean).join(' · ') || '–'}</Row>
              <Row label="Quelle">{SOURCE_LABEL[b.source] ?? b.source}</Row>
              <Row label="Zeitraum">
                {formatDate(b.start_at).slice(0, 6)} – {formatDate(b.end_at)}
              </Row>
              <Row label="Abholung">
                {formatPickup(b.end_at)} · {RETURN_MODE_LABEL[b.return_mode]}
              </Row>
              <Row label="Parkplatz">{PARKING_TYPE_LABEL[b.parking_type]}</Row>
              {b.fuel_type && <Row label="Antrieb">{FUEL_TYPE_LABEL[b.fuel_type]}</Row>}
              <Row label="Personen">{b.persons}</Row>
              <Row label="Preis">{b.price_total != null ? formatMoney(Number(b.price_total)) : '–'}</Row>
              <Row label="Zahlung"><PaymentBadge status={b.payment_status} /></Row>
              {b.notes && <Row label="Notizen">{b.notes}</Row>}
            </dl>
          </Card>

          <Card title="Ort & Schlüssel">
            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-xl border-2 p-3 ${b.location ? DUE_STYLE[due].tile : 'border-dashed border-line-strong'}`}>
                <div className="text-xs text-subtle">Stellplatz</div>
                <div className={`font-mono text-xl font-bold ${b.location ? DUE_STYLE[due].text : 'text-muted'}`}>
                  {b.location?.code ?? '–'}
                </div>
                <div className="text-xs text-subtle">
                  {b.location ? AREA_LABEL[b.location.area as LocationArea] : 'noch nicht eingecheckt'}
                </div>
              </div>
              <div className="rounded-xl bg-ground p-3">
                <div className="text-xs text-subtle">Schlüssel</div>
                <div className="font-mono text-xl font-bold">{key?.key_code ?? '–'}</div>
                <div className="text-xs text-subtle">{key ? key.storage_place : 'nicht zugeordnet'}</div>
              </div>
            </div>
            {!closed && (
              <div className="mt-3 flex flex-col gap-2">
                {b.location ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => setMove('relocate')}>Umsetzen</Button>
                    <Button variant="primary" onClick={() => setMove('checkout')}>Auschecken</Button>
                  </div>
                ) : (
                  <Link to={`/einchecken?booking=${b.id}`}
                    className="touch-target inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
                    Einchecken
                  </Link>
                )}
                {b.location && (
                  <Link to={`/lageplan?platz=${encodeURIComponent(b.location.code)}`} className="text-center text-sm text-accent underline">
                    Im Lageplan zeigen
                  </Link>
                )}
              </div>
            )}
            {moveNotice && <p className="mt-2 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok-ink">{moveNotice}</p>}
          </Card>
        </div>

        <Card title="Leistungen" aside={`${done} von ${relevant.length} erledigt`}>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-chip">
            <div className="h-full bg-ok" style={{ width: `${relevant.length ? (done / relevant.length) * 100 : 0}%` }} />
          </div>
          <ul className="flex flex-col gap-2">
            {relevant.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={setOpenTask} />
            ))}
          </ul>
          {services.some((s) => s.price_at_booking != null || s.description) && (
            <dl className="mt-3 border-t border-line pt-2">
              {services
                .filter((s) => s.status === 'active' && (s.price_at_booking != null || s.description))
                .map((s) => (
                  <Row key={s.id} label={s.service.name}>
                    {[s.description, s.price_at_booking != null && formatMoney(Number(s.price_at_booking))]
                      .filter(Boolean)
                      .join(' · ')}
                  </Row>
                ))}
            </dl>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Protokolle">
            <ul className="flex flex-col gap-2 text-sm">
              {(['intake', 'handover'] as const).map((type) => {
                const p = protocols.find((x) => x.type === type)
                const label = type === 'intake' ? 'Annahme' : 'Übergabe'
                const path = `/protokoll/${type === 'intake' ? 'annahme' : 'uebergabe'}/${b.id}`
                const status = p?.status === 'final'
                  ? `abgeschlossen ${formatDateTime(p.finalized_at!)}${p.mileage != null ? ` · ${p.mileage.toLocaleString('de-DE')} km` : ''}`
                  : p
                    ? 'Entwurf – noch nicht unterschrieben'
                    : type === 'intake'
                      ? 'noch nicht erstellt'
                      : `offen · bei Abholung ${formatPickup(b.end_at)}`
                const canStart = !closed || !!p
                return (
                  <li key={type}>
                    {canStart ? (
                      <Link to={path}
                        className={`touch-target flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 hover:bg-ground ${p?.status === 'final' ? 'border-ok/50 bg-ok-soft' : 'border-dashed border-line-strong'}`}>
                        <span>
                          <span className="block font-medium">{label}</span>
                          <span className="block text-xs text-subtle">{status}</span>
                        </span>
                        <span className="text-sm font-semibold text-accent">
                          {p?.status === 'final' ? 'PDF' : p ? 'Fortsetzen' : 'Starten'}
                        </span>
                      </Link>
                    ) : (
                      <div className="rounded-xl border border-dashed border-line-strong px-3 py-2.5">
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-subtle">{status}</div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Verlauf">
            <ol className="flex flex-col gap-2.5">
              {timeline.map((e, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${e.tone}`} aria-hidden="true" />
                  <span>
                    <span className="block">{e.text}</span>
                    <span className="block text-xs text-muted">{formatDateTime(e.at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {editing && (
        <BookingFormDialog
          initial={formFromBooking(
            b,
            services.map((s) => ({
              code: s.service.code,
              is_default: s.service.is_default,
              price_at_booking: s.price_at_booking,
              description: s.description,
              status: s.status,
            })),
          )}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      )}
      {openTask && <TaskSheet taskId={openTask} onClose={() => setOpenTask(null)} onChanged={load} />}
      {move && (
        <MoveDialog
          bookingId={b.id}
          plate={b.plate}
          fromCode={b.location?.code ?? null}
          mode={move}
          onClose={() => setMove(null)}
          onDone={(res) => {
            setMove(null)
            setMoveNotice(`${res.from ?? '–'} → ${res.to ?? 'übergeben'}`)
            load()
          }}
        />
      )}
      {confirmCancel && (
        <Dialog
          title="Buchung stornieren?"
          onClose={() => setConfirmCancel(false)}
          footer={
            <>
              <Button onClick={() => setConfirmCancel(false)}>Abbrechen</Button>
              <Button variant="danger" disabled={busy} onClick={() => void doCancel()}>
                Stornieren
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Die Buchung <strong>{b.plate}</strong> wird auf „storniert“ gesetzt, offene Aufgaben werden storniert. Es wird
            nichts gelöscht; die Buchung bleibt in der Historie sichtbar.
          </p>
        </Dialog>
      )}
    </div>
  )
}
