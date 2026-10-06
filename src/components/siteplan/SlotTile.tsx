import { DUE_STYLE, dueCategory } from '../../lib/due'
import { formatDate } from '../../lib/format'
import type { BoardSlot } from '../../lib/siteplan'

/** Ein Stellplatz im Raster – Farbe nach Abholdatum, frei gestrichelt, gesperrt grau. */
export function SlotTile({
  slot,
  selected,
  compact = false,
  onSelect,
}: {
  slot: BoardSlot
  selected: boolean
  compact?: boolean
  onSelect: (slot: BoardSlot) => void
}) {
  const occupied = !!slot.booking_id && !!slot.end_at
  const due = occupied ? dueCategory(slot.end_at!) : null
  const base = 'flex w-full flex-col rounded-xl border-2 p-2 text-left transition focus-visible:outline-3 focus-visible:outline-accent'
  const style = occupied
    ? `${DUE_STYLE[due!].tile} ${DUE_STYLE[due!].text}`
    : slot.status === 'blocked'
      ? 'border-dashed border-slot-blocked bg-slot-blocked-bg text-muted'
      : slot.status === 'reserved'
        ? 'border-dashed border-accent bg-accent-soft/40 text-accent-dark'
        : 'border-dashed border-slot-free bg-surface text-subtle'
  const ring = selected ? 'ring-3 ring-ink ring-offset-1' : ''
  const height = compact ? 'min-h-16' : 'min-h-28'

  return (
    <button type="button" onClick={() => onSelect(slot)} className={`${base} ${style} ${ring} ${height}`}
      aria-label={`${slot.code}${occupied ? ` ${slot.plate}` : slot.status === 'blocked' ? ' nur mit Umsetzen' : ' frei'}`}>
      {occupied ? (
        <>
          <span className="truncate font-mono text-[13px] font-semibold">{slot.plate}</span>
          {!compact && <span className="truncate text-xs opacity-80">{slot.vehicle_model}</span>}
          <span className="mt-auto text-xs font-bold">ab {formatDate(slot.end_at!).slice(0, 6)}</span>
          {!compact && (
            <span className="text-[11px] opacity-80">
              {slot.open_task_count > 0 ? `${slot.open_task_count} offen` : 'fertig'}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="text-[13px] font-semibold">{slot.status === 'blocked' ? 'gesperrt' : slot.status === 'reserved' ? 'reserviert' : 'frei'}</span>
          <span className="mt-auto text-[11px] opacity-80">{slot.code}</span>
        </>
      )}
    </button>
  )
}

export function Legend() {
  const items: [string, string][] = [
    ['border-due-today bg-due-today-bg', 'Heute'],
    ['border-due-tomorrow bg-due-tomorrow-bg', 'Morgen'],
    ['border-due-week bg-due-week-bg', 'Diese Woche'],
    ['border-due-later bg-due-later-bg', 'Später'],
    ['border-dashed border-slot-free bg-surface', 'Frei'],
    ['border-dashed border-slot-blocked bg-slot-blocked-bg', 'Nur mit Umsetzen'],
  ]
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
      {items.map(([cls, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`size-3 rounded-[3px] border-2 ${cls}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  )
}
