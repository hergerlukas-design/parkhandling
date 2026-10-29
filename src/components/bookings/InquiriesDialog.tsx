import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatDate, formatDateTime } from '../../lib/format'
import {
  formFromInquiry,
  INQUIRY_PARKING_LABEL,
  INQUIRY_SERVICE_LABEL,
  INQUIRY_STATUS_LABEL,
  listInquiries,
  OPEN_INQUIRY_STATUSES,
  setInquiryStatus,
  type Inquiry,
  type InquiryStatus,
} from '../../lib/landing'
import { Button, Dialog, ErrorList } from '../ui'
import { BookingFormDialog } from './BookingFormDialog'

const STATUS_STYLE: Record<InquiryStatus, string> = {
  new: 'bg-warn-soft text-warn-ink',
  contacted: 'bg-accent-soft text-accent-dark',
  converted: 'bg-ok-soft text-ok-ink',
  rejected: 'bg-chip text-subtle',
}

/** Anfragen der Landingpage: kontaktieren, ablehnen oder in eine Buchung übernehmen */
export function InquiriesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const navigate = useNavigate()
  const [openOnly, setOpenOnly] = useState(true)
  const [items, setItems] = useState<Inquiry[] | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [converting, setConverting] = useState<Inquiry | null>(null)

  const load = useCallback(() => {
    listInquiries(openOnly)
      .then(setItems)
      .catch((e: Error) => setErrors([e.message]))
  }, [openOnly])

  useEffect(load, [load])

  async function changeStatus(i: Inquiry, status: InquiryStatus) {
    setBusy(true)
    setErrors([])
    try {
      await setInquiryStatus(i.id, status)
      load()
      onChanged()
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setBusy(false)
    }
  }

  async function converted(i: Inquiry, bookingId: string) {
    try {
      await setInquiryStatus(i.id, 'converted', bookingId)
      onChanged()
      navigate(`/fahrzeuge/${bookingId}`)
    } catch (e) {
      setConverting(null)
      setErrors([`Buchung angelegt, Anfrage aber nicht als übernommen markiert: ${(e as Error).message}`])
      load()
    }
  }

  if (converting) {
    return (
      <BookingFormDialog
        initial={formFromInquiry(converting)}
        draftKey={`inquiry-${converting.id}`}
        title={`Anfrage übernehmen · ${converting.plate}`}
        onClose={() => setConverting(null)}
        onSaved={(id) => void converted(converting, id)}
      />
    )
  }

  return (
    <Dialog title="Anfragen von der Website" onClose={onClose}>
      <div className="mb-3 flex gap-2" role="group" aria-label="Filter">
        {([true, false] as const).map((v) => (
          <button key={String(v)} type="button" onClick={() => setOpenOnly(v)}
            className={`touch-target rounded-full border px-4 py-1.5 text-sm font-medium ${
              openOnly === v ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'
            }`}>
            {v ? 'Offen' : 'Alle'}
          </button>
        ))}
      </div>
      {errors.length > 0 && (
        <div className="mb-3">
          <ErrorList errors={errors} />
        </div>
      )}
      {items === null && <p className="text-sm text-muted">Lädt …</p>}
      {items?.length === 0 && (
        <p className="rounded-xl border border-line px-4 py-6 text-center text-sm text-muted">
          {openOnly ? 'Keine offenen Anfragen.' : 'Noch keine Anfragen.'}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items?.map((i) => {
          const open = OPEN_INQUIRY_STATUSES.includes(i.status)
          return (
            <li key={i.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-base font-semibold">{i.plate}</span>
                <span className="font-medium">{i.first_name} {i.last_name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[i.status]}`}>
                  {INQUIRY_STATUS_LABEL[i.status]}
                </span>
                <span className="ml-auto text-xs text-muted">eingegangen {formatDateTime(i.created_at)}</span>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <div><dt className="inline text-subtle">Zeitraum: </dt><dd className="inline">{formatDate(i.arrival_date)} – {formatDate(i.pickup_date)}</dd></div>
                <div><dt className="inline text-subtle">Parkplatz: </dt><dd className="inline">{INQUIRY_PARKING_LABEL[i.parking_type]}</dd></div>
                <div>
                  <dt className="inline text-subtle">Kontakt: </dt>
                  <dd className="inline">
                    <a className="text-accent underline" href={`mailto:${i.email}`}>{i.email}</a>
                    {i.phone && <> · <a className="text-accent underline" href={`tel:${i.phone.replace(/[^0-9+]/g, '')}`}>{i.phone}</a></>}
                  </dd>
                </div>
                {i.services.length > 0 && (
                  <div><dt className="inline text-subtle">Wünsche: </dt><dd className="inline">{i.services.map((s) => INQUIRY_SERVICE_LABEL[s] ?? s).join(', ')}</dd></div>
                )}
                {i.message && (
                  <div className="sm:col-span-2"><dt className="inline text-subtle">Nachricht: </dt><dd className="inline whitespace-pre-line">{i.message}</dd></div>
                )}
                {i.utm_source && (
                  <div className="sm:col-span-2 text-xs text-muted">Quelle: {[i.utm_source, i.utm_campaign].filter(Boolean).join(' · ')}</div>
                )}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {open && (
                  <Button variant="primary" disabled={busy} onClick={() => setConverting(i)}>In Buchung übernehmen</Button>
                )}
                {i.status === 'new' && (
                  <Button disabled={busy} onClick={() => void changeStatus(i, 'contacted')}>Kontaktiert</Button>
                )}
                {open && (
                  <Button disabled={busy} onClick={() => void changeStatus(i, 'rejected')}>Ablehnen</Button>
                )}
                {i.status === 'rejected' && (
                  <Button disabled={busy} onClick={() => void changeStatus(i, 'new')}>Wieder öffnen</Button>
                )}
                {i.converted_booking_id && (
                  <Link to={`/fahrzeuge/${i.converted_booking_id}`} onClick={onClose}
                    className="touch-target inline-flex items-center text-sm font-semibold text-accent underline">
                    Zur Buchung
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
