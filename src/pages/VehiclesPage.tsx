import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { BookingFormDialog } from '../components/bookings/BookingFormDialog'
import { ImportDialog } from '../components/bookings/ImportDialog'
import { Icon } from '../components/Icon'
import { Button, PaymentBadge, StatusBadge } from '../components/ui'
import {
  countByChip,
  LIST_CHIPS,
  listBookings,
  type BookingCursor,
  type BookingListItem,
  type ListChip,
  type TaskChip,
} from '../lib/bookings'
import { DUE_STYLE, dueCategory, formatPeriod, formatPickup } from '../lib/due'

/** "Aufbereitung innen" → "Innen" (kompakte Chips wie im Klick-Prototyp) */
function shortTitle(title: string | null): string {
  const t = (title ?? '').replace(/^Aufbereitung\s+/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function ServiceChips({ chips }: { chips: TaskChip[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => {
        const done = c.status === 'done'
        const cls = done
          ? 'bg-ok-soft text-ok-ink'
          : c.is_default
            ? 'bg-chip text-subtle'
            : 'bg-warn-soft text-warn-ink'
        return (
          <span key={i} className={`rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}>
            {shortTitle(c.title)}
            {done && ' ✓'}
          </span>
        )
      })}
    </div>
  )
}

function PickupCell({ b }: { b: BookingListItem }) {
  const due = dueCategory(b.end_at)
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`size-2.5 rounded-sm ${DUE_STYLE[due].dot}`} aria-hidden="true" />
      {formatPickup(b.end_at)}
    </span>
  )
}

export function VehiclesPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [params] = useSearchParams()
  const [chip, setChip] = useState<ListChip>(() => {
    const f = params.get('filter')
    return LIST_CHIPS.some(([c]) => c === f) ? (f as ListChip) : 'all'
  })
  const [counts, setCounts] = useState<Partial<Record<ListChip, number>>>({})
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

  const load = useCallback(
    async (cursor: BookingCursor | null) => {
      const id = ++requestId.current
      setLoading(true)
      setError(null)
      try {
        const page = await listBookings({ search: debounced, chip }, cursor)
        if (id !== requestId.current) return
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items))
        setNext(page.next)
      } catch (e) {
        if (id === requestId.current) setError((e as Error).message)
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [debounced, chip],
  )

  const reload = useCallback(() => {
    void load(null)
    countByChip(debounced).then(setCounts).catch(() => undefined)
  }, [load, debounced])

  useEffect(() => {
    reload()
  }, [reload])

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-col gap-2 md:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Suche</span>
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kennzeichen, Kunde oder Buchungsnummer"
            className="touch-target w-full rounded-xl border border-line-strong bg-surface py-2 pr-3 pl-10 text-base md:text-sm"
          />
        </label>
        <div className="flex gap-2">
          <Button className="flex-1 md:flex-none" onClick={() => setDialog('import')}>
            <span className="md:hidden">Import</span>
            <span className="hidden md:inline">Buchungen importieren</span>
          </Button>
          <Button variant="primary" className="flex-1 md:flex-none" onClick={() => setDialog('new')}>
            + <span className="md:hidden">Buchung</span>
            <span className="hidden md:inline">Buchung anlegen</span>
          </Button>
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter">
        {LIST_CHIPS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setChip(value)}
            className={`touch-target shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap ${
              chip === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'
            }`}
          >
            {label}
            {counts[value] !== undefined && <span className="ml-1.5 opacity-70">{counts[value]}</span>}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Tablet/Desktop: Tabelle */}
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ground/60 text-xs font-semibold text-subtle">
            <tr>
              <th className="px-4 py-2.5">Kennzeichen</th>
              <th className="px-3 py-2.5">Fahrzeug</th>
              <th className="px-3 py-2.5">Ort</th>
              <th className="px-3 py-2.5">Zeitraum</th>
              <th className="px-3 py-2.5">Abholung</th>
              <th className="px-3 py-2.5">Leistungen</th>
              <th className="px-3 py-2.5">Zahlung</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr
                key={b.id}
                onClick={() => navigate(`/fahrzeuge/${b.id}`)}
                className="cursor-pointer border-t border-line first:border-0 hover:bg-ground/60"
              >
                <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap">{b.plate}</td>
                <td className="px-3 py-3">{b.vehicle_model ?? '–'}</td>
                <td className="px-3 py-3 whitespace-nowrap">{b.location_code ?? '–'}</td>
                <td className="px-3 py-3 whitespace-nowrap">{formatPeriod(b.start_at, b.end_at)}</td>
                <td className="px-3 py-3"><PickupCell b={b} /></td>
                <td className="px-3 py-3"><ServiceChips chips={b.task_chips} /></td>
                <td className="px-3 py-3"><PaymentBadge status={b.payment_status} /></td>
                <td className="px-3 py-3"><StatusBadge status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Smartphone: Karten mit Farbbalken nach Abholdatum */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((b) => {
          const due = dueCategory(b.end_at)
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => navigate(`/fahrzeuge/${b.id}`)}
                className="flex w-full gap-3 rounded-2xl border border-line bg-surface p-3 text-left"
              >
                <span className={`w-1.5 shrink-0 rounded-full ${DUE_STYLE[due].bar}`} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-base font-semibold">{b.plate}</span>
                    <span className="text-sm text-subtle">{b.location_code ?? ''}</span>
                  </span>
                  <span className="truncate text-sm text-subtle">{b.vehicle_model ?? b.customer_name}</span>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold">Abholung {formatPickup(b.end_at)}</span>
                    {b.status === 'cancelled' ? (
                      <span className="text-danger">storniert</span>
                    ) : b.open_task_count > 0 ? (
                      <span className="text-warn">{b.open_task_count} offen</span>
                    ) : (
                      <span className="text-ok">fertig</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {!loading && items.length === 0 && (
        <p className="rounded-2xl border border-line bg-surface px-4 py-8 text-center text-sm text-muted">
          Keine Fahrzeuge gefunden.
        </p>
      )}
      {(loading || next) && (
        <div className="p-2 text-center">
          {loading ? (
            <span className="text-sm text-muted">Lädt …</span>
          ) : (
            <Button onClick={() => void load(next)}>Weitere laden</Button>
          )}
        </div>
      )}

      {dialog === 'new' && (
        <BookingFormDialog onClose={() => setDialog(null)} onSaved={(id) => navigate(`/fahrzeuge/${id}`)} />
      )}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={reload} />}
    </div>
  )
}
