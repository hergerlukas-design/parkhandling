import { Link } from 'react-router'
import { DUE_STYLE, dueCategory, formatPickup } from '../../lib/due'
import type { BoardSlot } from '../../lib/siteplan'
import { AREA_LABEL, RETURN_MODE_LABEL } from '../../types/domain'
import { Icon } from '../Icon'
import { Button } from '../ui'

const DUE_LABEL = { today: 'Abholung heute', tomorrow: 'Abholung morgen', week: 'Diese Woche', later: 'Später' }

function where(slot: BoardSlot): string {
  if (slot.area === 'hall') return `Halle · Regal R${slot.rack} · Ebene E${slot.level}`
  if (slot.row) return `${AREA_LABEL[slot.area]} · Reihe ${slot.row} · Platz ${slot.number}`
  return `${slot.name ?? slot.code} · ${AREA_LABEL[slot.area]}`
}

/** Detail eines Platzes: rechts als Panel (Tablet), unten als Sheet (Smartphone). */
export function SlotPanel({
  slot,
  blockedBy,
  onClose,
  onCheckout,
  onRelocate,
}: {
  slot: BoardSlot
  blockedBy: string | null
  onClose: () => void
  onCheckout: () => void
  onRelocate: () => void
}) {
  const occupied = !!slot.booking_id
  const due = slot.end_at ? dueCategory(slot.end_at) : null
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-subtle">{where(slot)}</div>
        <button type="button" onClick={onClose} aria-label="Schließen"
          className="touch-target -mt-2 -mr-2 flex items-center justify-center rounded-full text-muted hover:bg-chip">
          <Icon name="close" className="size-5" />
        </button>
      </div>
      {occupied ? (
        <>
          <div>
            <div className="font-mono text-3xl font-bold">{slot.plate}</div>
            <div className="text-subtle">{slot.vehicle_model}</div>
          </div>
          {due && slot.end_at && (
            <span className={`self-start rounded-full border px-3 py-0.5 text-sm font-semibold ${DUE_STYLE[due].tile} ${DUE_STYLE[due].text}`}>
              {DUE_LABEL[due]}
            </span>
          )}
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-subtle">Abholung</dt>
              <dd>{slot.end_at ? formatPickup(slot.end_at) : '–'}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Rückgabe</dt>
              <dd>{slot.return_mode ? RETURN_MODE_LABEL[slot.return_mode] : '–'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-subtle">Leistungen</dt>
              <dd>{slot.open_task_count > 0 ? `${slot.open_task_count} offen` : 'alle erledigt'}</dd>
            </div>
            {slot.capacity > 1 && (
              <div className="col-span-2">
                <dt className="text-xs text-subtle">Auslastung</dt>
                <dd>{slot.occupancy} von {slot.capacity} Fahrzeugen</dd>
              </div>
            )}
          </dl>
          <div className="mt-auto flex flex-col gap-2">
            <Button variant="primary" onClick={onCheckout}>Auschecken</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={onRelocate}>Umsetzen</Button>
              <Link to={`/fahrzeuge/${slot.booking_id}`}
                className="touch-target inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold">
                Details
              </Link>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="font-mono text-3xl font-bold">{slot.code}</div>
          {slot.status === 'blocked' ? (
            <p className="rounded-xl bg-slot-blocked-bg px-3 py-2 text-sm">
              Nur mit Umsetzen erreichbar{blockedBy ? `: darunter steht ${blockedBy}` : ''}. Einlagern geht nur von oben nach unten.
            </p>
          ) : (
            <p className="text-sm text-subtle">Frei{slot.capacity > 1 ? ` (${slot.occupancy}/${slot.capacity})` : ''}.</p>
          )}
          {slot.status !== 'blocked' && (
            <Link to={`/einchecken?platz=${encodeURIComponent(slot.code)}`}
              className="touch-target mt-auto inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
              Fahrzeug hier einchecken
            </Link>
          )}
        </>
      )}
    </div>
  )
}
