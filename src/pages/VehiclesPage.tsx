import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { BookingFormDialog } from '../components/bookings/BookingFormDialog'
import { ImportDialog } from '../components/bookings/ImportDialog'
import { Page } from '../components/Page'
import { Button, Select, StatusBadge, TextInput } from '../components/ui'
import { listBookings, type BookingCursor, type BookingFilter, type BookingListItem, type PickupFilter } from '../lib/bookings'
import { formatDate, formatTime } from '../lib/format'
import { BOOKING_STATUS_LABEL, PARKING_TYPE_LABEL, type BookingStatus, type ParkingType } from '../types/domain'

const PICKUP: [PickupFilter, string][] = [
  ['all', 'Alle'],
  ['today', 'Heute'],
  ['tomorrow', 'Morgen'],
  ['week', '7 Tage'],
  ['overdue', 'Überfällig'],
]

export function VehiclesPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [pickup, setPickup] = useState<PickupFilter>('all')
  const [status, setStatus] = useState<BookingStatus | ''>('')
  const [parkingType, setParkingType] = useState<ParkingType | ''>('')
  const [items, setItems] = useState<BookingListItem[]>([])
  const [next, setNext] = useState<BookingCursor | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'new' | 'import' | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const filter: BookingFilter = {
    search: debounced,
    pickup,
    parkingType,
    statuses: status ? [status] : undefined,
    activeOnly: !status,
  }

  const load = useCallback(
    async (cursor: BookingCursor | null) => {
      const id = ++requestId.current
      setLoading(true)
      setError(null)
      try {
        const page = await listBookings(filter, cursor)
        if (id !== requestId.current) return
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items))
        setNext(page.next)
      } catch (e) {
        if (id === requestId.current) setError((e as Error).message)
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [debounced, pickup, status, parkingType],
  )

  useEffect(() => {
    void load(null)
  }, [load])

  return (
    <Page
      title="Fahrzeuge"
      actions={
        <div className="flex gap-2">
          <Button onClick={() => setDialog('import')}>Import</Button>
          <Button variant="primary" onClick={() => setDialog('new')}>Neue Buchung</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr]">
          <TextInput type="search" placeholder="Kennzeichen, Name oder Buchungsnr." value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | '')} aria-label="Status">
            <option value="">Alle aktiven</option>
            {Object.entries(BOOKING_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
          <Select value={parkingType} onChange={(e) => setParkingType(e.target.value as ParkingType | '')} aria-label="Bereich">
            <option value="">Alle Bereiche</option>
            {Object.entries(PARKING_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Abholung">
          {PICKUP.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setPickup(v)}
              className={`touch-target rounded-full px-4 py-1.5 text-sm font-medium ${
                pickup === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="hidden bg-slate-50 text-xs text-slate-500 md:table-header-group">
            <tr>
              <th className="px-4 py-2">Kennzeichen</th>
              <th className="px-4 py-2">Kunde</th>
              <th className="px-4 py-2">Abholung</th>
              <th className="px-4 py-2">Parkart</th>
              <th className="px-4 py-2">Ort</th>
              <th className="px-4 py-2">Offen</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => {
              const open = b.open_tasks[0]?.count ?? 0
              return (
                <tr key={b.id} onClick={() => navigate(`/fahrzeuge/${b.id}`)}
                  className="grid cursor-pointer grid-cols-[1fr_auto] gap-x-3 border-t border-slate-100 px-4 py-3 first:border-0 hover:bg-slate-50 md:table-row md:p-0">
                  <td className="font-semibold md:px-4 md:py-3">{b.plate}</td>
                  <td className="col-start-1 text-slate-600 md:px-4 md:py-3 md:text-slate-900">{b.customer_name}</td>
                  <td className="col-start-2 row-start-1 text-right md:px-4 md:py-3 md:text-left">
                    {formatDate(b.end_at)} <span className="text-slate-500">{formatTime(b.end_at)}</span>
                  </td>
                  <td className="hidden md:table-cell md:px-4 md:py-3">{PARKING_TYPE_LABEL[b.parking_type]}</td>
                  <td className="hidden md:table-cell md:px-4 md:py-3">{b.location?.code ?? '–'}</td>
                  <td className="hidden md:table-cell md:px-4 md:py-3">
                    {open > 0 ? <span className="font-semibold text-amber-700">{open}</span> : '–'}
                  </td>
                  <td className="col-start-2 row-start-2 text-right md:px-4 md:py-3 md:text-left">
                    <StatusBadge status={b.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Keine Fahrzeuge gefunden.</p>
        )}
        {(loading || next) && (
          <div className="border-t border-slate-100 p-3 text-center">
            {loading ? (
              <span className="text-sm text-slate-500">Lädt …</span>
            ) : (
              <Button onClick={() => void load(next)}>Weitere laden</Button>
            )}
          </div>
        )}
      </div>

      {dialog === 'new' && (
        <BookingFormDialog onClose={() => setDialog(null)} onSaved={(id) => navigate(`/fahrzeuge/${id}`)} />
      )}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={() => void load(null)} />}
    </Page>
  )
}
