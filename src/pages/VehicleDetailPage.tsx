import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Card, Page } from '../components/Page'
import { StatusBadge } from '../components/ui'
import { getBookingDetail, type BookingDetail } from '../lib/bookings'
import { formatDateTime } from '../lib/format'
import { AREA_LABEL, PARKING_TYPE_LABEL, type LocationArea, type TaskStatus } from '../types/domain'

const TASK_STATUS: Record<TaskStatus, string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
  cancelled: 'Storniert',
}

const FIELD_LABEL: Record<string, string> = {
  customer_name: 'Kunde',
  customer_email: 'E-Mail',
  customer_phone: 'Telefon',
  plate: 'Kennzeichen',
  vehicle_model: 'Fahrzeug',
  persons: 'Personen',
  start_at: 'Ankunft',
  end_at: 'Abholung',
  parking_type: 'Parkart',
  return_mode: 'Rückgabe',
  status: 'Status',
  notes: 'Bemerkung',
  external_ref: 'Buchungsnummer',
  service_added: 'Leistung gebucht',
  service_cancelled: 'Leistung storniert',
}

function describeChange(key: string, value: unknown): string {
  const v = value as { old?: unknown; new?: unknown; code?: string }
  if (key === 'service_added' || key === 'service_cancelled') return `${FIELD_LABEL[key]}: ${v.code}`
  const fmt = (x: unknown) =>
    typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) ? formatDateTime(x) : x === null ? '–' : String(x)
  return `${FIELD_LABEL[key] ?? key}: ${fmt(v.old)} → ${fmt(v.new)}`
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}

export function VehicleDetailPage() {
  const { id } = useParams()
  const [data, setData] = useState<BookingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getBookingDetail(id).then(setData).catch((e: Error) => setError(e.message))
  }, [id])

  if (error) return <Page title="Fahrzeug"><p className="text-sm text-red-600">{error}</p></Page>
  if (!data) return <Page title="Fahrzeug"><p className="text-sm text-slate-500">Lädt …</p></Page>

  const { booking: b, services, tasks, history, movements } = data
  const relevant = tasks.filter((t) => t.status !== 'cancelled' && t.type !== 'relocate')
  const done = relevant.filter((t) => t.status === 'done').length

  return (
    <Page
      title={b.plate}
      actions={
        <div className="flex items-center gap-3">
          <StatusBadge status={b.status} />
          <Link to="/fahrzeuge" className="text-sm text-brand-700 underline">Zur Liste</Link>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Stammdaten">
          <dl>
            <Row label="Kunde">{b.customer_name}</Row>
            {b.customer_email && <Row label="E-Mail">{b.customer_email}</Row>}
            {b.customer_phone && <Row label="Telefon">{b.customer_phone}</Row>}
            {b.vehicle_model && <Row label="Fahrzeug">{b.vehicle_model}</Row>}
            <Row label="Ankunft">{formatDateTime(b.start_at)}</Row>
            <Row label="Abholung">{formatDateTime(b.end_at)}</Row>
            <Row label="Parkart">{PARKING_TYPE_LABEL[b.parking_type]}</Row>
            <Row label="Personen">{b.persons}</Row>
            <Row label="Aktueller Ort">
              {b.location ? `${b.location.code} (${AREA_LABEL[b.location.area as LocationArea]})` : '–'}
            </Row>
            <Row label="Buchung">{b.external_ref ? `${b.source} · ${b.external_ref}` : b.source}</Row>
            {b.notes && <Row label="Bemerkung">{b.notes}</Row>}
          </dl>
        </Card>

        <Card title={`Leistungen · ${done}/${relevant.length} erledigt`}>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-500" style={{ width: `${relevant.length ? (done / relevant.length) * 100 : 0}%` }} />
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {services.map((s) => {
              const task = tasks.find((t) => t.booking_service_id === s.id && t.status !== 'cancelled')
              return (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span className={s.status === 'cancelled' ? 'text-slate-400 line-through' : ''}>{s.service.name}</span>
                  <span className="text-slate-500">
                    {s.status === 'cancelled' ? 'Storniert' : task ? TASK_STATUS[task.status] : '–'}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card title="Bewegungshistorie">
          {movements.length === 0 ? (
            <p className="text-sm text-slate-500">Noch keine Bewegungen.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {movements.map((m) => (
                <li key={m.id} className="flex justify-between gap-3">
                  <span>{m.from?.code ?? '–'} → {m.to?.code ?? 'übergeben'}{m.reason ? ` · ${m.reason}` : ''}</span>
                  <span className="text-slate-500">{formatDateTime(m.moved_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Buchungshistorie">
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">Keine Änderungen seit Anlage ({formatDateTime(b.created_at)}).</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="text-xs text-slate-500">{formatDateTime(h.changed_at)} · {h.source}</div>
                  {Object.entries(h.changed_fields).map(([k, v]) => (
                    <div key={k}>{describeChange(k, v)}</div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  )
}
