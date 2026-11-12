import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { IMPORT_FLAG_LABEL, type ImportFlag } from '../booking-adapters'
import { BookingFormDialog } from '../components/bookings/BookingFormDialog'
import { ImportDialog } from '../components/bookings/ImportDialog'
import { ImportReviewDialog } from '../components/bookings/ImportReviewDialog'
import { InquiriesDialog } from '../components/bookings/InquiriesDialog'
import { ParkosImportDialog } from '../components/bookings/ParkosImportDialog'
import { countOpenImports } from '../lib/imports'
import { countNewInquiries, LANDING_SOURCE } from '../lib/landing'
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
import { hasKeySlot, whereabouts } from '../lib/siteplan'

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

/** Buchung angelegt, Fahrzeug aber noch nicht auf dem Gelände (Status „Gebucht“). */
function notArrived(b: BookingListItem): boolean {
  return b.status === 'booked'
}

/** Kleine Hinweise neben dem Kennzeichen: noch nicht angekommen, Portal-Quelle und offene Import-Prüfung */
function SourceBadges({ b, hidePending = false }: { b: BookingListItem; hidePending?: boolean }) {
  const flags = b.import_flags ?? []
  return (
    <>
      {notArrived(b) && !hidePending && (
        <span
          title={`Ankunft ${formatPickup(b.start_at)}`}
          className="ml-1.5 rounded border border-dashed border-line-strong bg-ground px-1.5 py-0.5 align-middle text-[10px] font-semibold text-subtle"
        >
          noch nicht da
        </span>
      )}
      {b.source === 'parkos' && (
        <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 align-middle text-[10px] font-semibold text-accent-dark">
          Parkos
        </span>
      )}
      {b.source === LANDING_SOURCE && (
        <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 align-middle text-[10px] font-semibold text-accent-dark">
          Website
        </span>
      )}
      {flags.length > 0 && (
        <span
          title={flags.map((f) => IMPORT_FLAG_LABEL[f as ImportFlag] ?? f).join(', ')}
          className="ml-1 rounded bg-warn-soft px-1.5 py-0.5 align-middle text-[10px] font-semibold text-warn-ink"
        >
          prüfen
        </span>
      )}
    </>
  )
}

/** Stellplatz/Fach in der Liste; reservierte Plätze noch nicht angekommener Fahrzeuge nur im Detail. */
function locationOf(b: BookingListItem): string | null {
  return notArrived(b) ? null : b.location_code
}

function VehicleRow({ b, hidePending, onOpen }: { b: BookingListItem; hidePending?: boolean; onOpen: () => void }) {
  const code = locationOf(b)
  return (
    <tr onClick={onOpen} className="cursor-pointer border-t border-line first:border-0 hover:bg-ground/60">
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono font-semibold">{b.plate}</span>
        <SourceBadges b={b} hidePending={hidePending} />
      </td>
      <td className="px-3 py-3">{b.vehicle_model ?? '–'}</td>
      <td className="px-3 py-3 whitespace-nowrap">
        {hasKeySlot(code) ? (
          <span className="font-mono font-semibold">{code}</span>
        ) : code ? (
          <span>{whereabouts(code)} <span className="font-mono text-xs text-muted">{code}</span></span>
        ) : (
          '–'
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">{formatPeriod(b.start_at, b.end_at)}</td>
      <td className="px-3 py-3"><PickupCell b={b} /></td>
      <td className="px-3 py-3"><ServiceChips chips={b.task_chips} /></td>
      <td className="px-3 py-3"><PaymentBadge status={b.payment_status} /></td>
      <td className="px-3 py-3"><StatusBadge status={b.status} /></td>
    </tr>
  )
}

function VehicleCard({ b, hidePending, onOpen }: { b: BookingListItem; hidePending?: boolean; onOpen: () => void }) {
  const due = dueCategory(b.end_at)
  const pending = notArrived(b)
  const late = pending && Date.parse(b.start_at) < Date.now()
  const code = locationOf(b)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full gap-3 rounded-2xl border p-3 text-left ${
          pending ? 'border-dashed border-line-strong bg-surface/60' : 'border-line bg-surface'
        }`}
      >
        <span
          className={`w-1.5 shrink-0 rounded-full ${DUE_STYLE[due].bar} ${pending ? 'opacity-30' : ''}`}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <span>
              <span className="font-mono text-base font-semibold">{b.plate}</span>
              <SourceBadges b={b} hidePending={hidePending} />
            </span>
            <span className="text-sm text-subtle">{hasKeySlot(code) ? code : code ? whereabouts(code) : ''}</span>
          </span>
          <span className="truncate text-sm text-subtle">{b.vehicle_model ?? b.customer_name}</span>
          {pending && (
            <span className={`text-sm font-semibold ${late ? 'text-warn' : 'text-accent-dark'}`}>
              Ankunft {formatPickup(b.start_at)}
              {late && ' – überfällig'}
            </span>
          )}
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
}

/** Trennlinie in „Alle“ zwischen Fahrzeugen vor Ort und noch nicht angekommenen Buchungen */
function ExpectedDivider({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3 pt-3 pb-1" role="separator">
      <span className="h-px flex-1 bg-line-strong" aria-hidden="true" />
      <span className="text-xs font-semibold whitespace-nowrap text-subtle">
        Gebucht – noch nicht angekommen{count > 0 && ` · ${count}`}
      </span>
      <span className="h-px flex-1 bg-line-strong" aria-hidden="true" />
    </div>
  )
}

const TABLE_HEAD = (
  <thead className="border-b border-line bg-ground/60 text-xs font-semibold text-subtle">
    <tr>
      <th className="px-4 py-2.5">Kennzeichen</th>
      <th className="px-3 py-2.5">Fahrzeug</th>
      <th className="px-3 py-2.5">Stellplatz / Fach</th>
      <th className="px-3 py-2.5">Zeitraum</th>
      <th className="px-3 py-2.5">Abholung</th>
      <th className="px-3 py-2.5">Leistungen</th>
      <th className="px-3 py-2.5">Zahlung</th>
      <th className="px-3 py-2.5">Status</th>
    </tr>
  </thead>
)

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
  // Nur bei „Alle“: noch nicht angekommene Buchungen als eigener Abschnitt unter der Linie
  const split = chip === 'all'
  const [expected, setExpected] = useState<BookingListItem[]>([])
  const [expectedNext, setExpectedNext] = useState<BookingCursor | null>(null)
  const [expectedLoading, setExpectedLoading] = useState(false)
  const expectedRequestId = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'new' | 'import' | 'parkos' | 'review' | 'inquiries' | null>(null)
  const [openImports, setOpenImports] = useState(0)
  const [newInquiries, setNewInquiries] = useState(0)
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
        const page = await listBookings({ search: debounced, chip, arrival: split ? 'on_site' : undefined }, cursor)
        if (id !== requestId.current) return
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items))
        setNext(page.next)
      } catch (e) {
        if (id === requestId.current) setError((e as Error).message)
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [debounced, chip, split],
  )

  const loadExpected = useCallback(
    async (cursor: BookingCursor | null) => {
      const id = ++expectedRequestId.current
      if (!split) {
        setExpected([])
        setExpectedNext(null)
        return
      }
      setExpectedLoading(true)
      try {
        const page = await listBookings({ search: debounced, chip, arrival: 'expected' }, cursor)
        if (id !== expectedRequestId.current) return
        setExpected((prev) => (cursor ? [...prev, ...page.items] : page.items))
        setExpectedNext(page.next)
      } catch (e) {
        if (id === expectedRequestId.current) setError((e as Error).message)
      } finally {
        if (id === expectedRequestId.current) setExpectedLoading(false)
      }
    },
    [debounced, chip, split],
  )

  const reload = useCallback(() => {
    void load(null)
    void loadExpected(null)
    countByChip(debounced).then(setCounts).catch(() => undefined)
    countOpenImports().then(setOpenImports).catch(() => undefined)
    countNewInquiries().then(setNewInquiries).catch(() => undefined)
  }, [load, loadExpected, debounced])

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
        <div className="flex flex-wrap gap-2">
          {openImports > 0 && (
            <Button className="flex-1 border-warn bg-warn-soft text-warn-ink md:flex-none" onClick={() => setDialog('review')}>
              {openImports} prüfen
            </Button>
          )}
          <Button
            className={`flex-1 md:flex-none ${newInquiries > 0 ? 'border-warn bg-warn-soft text-warn-ink' : ''}`}
            onClick={() => setDialog('inquiries')}
          >
            Anfragen{newInquiries > 0 && ` (${newInquiries} neu)`}
          </Button>
          <Button className="flex-1 md:flex-none" onClick={() => setDialog('parkos')}>
            Parkos-Mail
          </Button>
          <Button className="flex-1 md:flex-none" onClick={() => setDialog('import')}>
            <span className="md:hidden">Excel</span>
            <span className="hidden md:inline">Excel/CSV</span>
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
      {(items.length > 0 || !split) && (
        <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
          <table className="w-full text-left text-sm">
            {TABLE_HEAD}
            <tbody>
              {items.map((b) => (
                <VehicleRow key={b.id} b={b} onOpen={() => navigate(`/fahrzeuge/${b.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Smartphone: Karten mit Farbbalken nach Abholdatum */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((b) => (
          <VehicleCard key={b.id} b={b} onOpen={() => navigate(`/fahrzeuge/${b.id}`)} />
        ))}
      </ul>

      {!loading && items.length === 0 && (!split || expected.length === 0) && (
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

      {split && expected.length > 0 && (
        <>
          <ExpectedDivider count={expectedNext ? 0 : expected.length} />
          <div className="hidden overflow-hidden rounded-2xl border border-dashed border-line-strong bg-surface md:block">
            <table className="w-full text-left text-sm">
              {TABLE_HEAD}
              <tbody>
                {expected.map((b) => (
                  <VehicleRow key={b.id} b={b} hidePending onOpen={() => navigate(`/fahrzeuge/${b.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {expected.map((b) => (
              <VehicleCard key={b.id} b={b} hidePending onOpen={() => navigate(`/fahrzeuge/${b.id}`)} />
            ))}
          </ul>
          {(expectedLoading || expectedNext) && (
            <div className="p-2 text-center">
              {expectedLoading ? (
                <span className="text-sm text-muted">Lädt …</span>
              ) : (
                <Button onClick={() => void loadExpected(expectedNext)}>Weitere laden</Button>
              )}
            </div>
          )}
        </>
      )}

      {dialog === 'new' && (
        <BookingFormDialog onClose={() => setDialog(null)} onSaved={(id) => navigate(`/fahrzeuge/${id}`)} />
      )}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={reload} />}
      {dialog === 'parkos' && <ParkosImportDialog onClose={() => setDialog(null)} onDone={reload} />}
      {dialog === 'review' && <ImportReviewDialog onClose={() => setDialog(null)} onChanged={reload} />}
      {dialog === 'inquiries' && <InquiriesDialog onClose={() => setDialog(null)} onChanged={reload} />}
    </div>
  )
}
