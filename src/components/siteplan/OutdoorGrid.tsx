import type { BoardSlot } from '../../lib/siteplan'
import { SlotTile } from './SlotTile'

/** Außenbereiche als Reihen mit Platznummern (Code A1-07). */
export function OutdoorGrid({
  slots,
  selectedId,
  onSelect,
}: {
  slots: BoardSlot[]
  selectedId: string | null
  onSelect: (slot: BoardSlot) => void
}) {
  const areas: { area: BoardSlot['area']; title: string }[] = [
    { area: 'outdoor_a', title: 'Außen A · mit Abdeckplane' },
    { area: 'outdoor_b', title: 'Außen B · ohne Plane' },
  ]
  return (
    <div className="flex flex-col gap-4">
      {areas.map(({ area, title }) => {
        const inArea = slots.filter((s) => s.area === area)
        const rows = [...new Set(inArea.map((s) => s.row!))].sort()
        const used = inArea.filter((s) => s.booking_id).length
        return (
          <section key={area} className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-3 flex items-baseline justify-between text-base font-semibold">
              {title}
              <span className="text-sm font-normal text-muted">{used}/{inArea.length} belegt</span>
            </h2>
            <div className="flex flex-col gap-3">
              {rows.map((row) => (
                <div key={row}>
                  <div className="mb-1 text-xs font-semibold text-subtle">Reihe {row}</div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12">
                    {inArea
                      .filter((s) => s.row === row)
                      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
                      .map((s) => (
                        <SlotTile key={s.id} slot={s} compact selected={s.id === selectedId} onSelect={onSelect} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Arbeitsorte, Puffer und „unterwegs“ mit Auslastung. */
export function WorkAreas({
  slots,
  selectedId,
  onSelect,
}: {
  slots: BoardSlot[]
  selectedId: string | null
  onSelect: (slot: BoardSlot) => void
}) {
  const places = slots.filter((s) => s.area === 'work' || s.area === 'buffer' || s.area === 'transit')
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 text-base font-semibold">Arbeitsorte, Puffer, unterwegs</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {places.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className={`flex min-h-20 flex-col rounded-xl border-2 p-2 text-left ${
              s.occupancy > 0 ? 'border-accent bg-accent-soft/50' : 'border-dashed border-slot-free'
            } ${s.id === selectedId ? 'ring-3 ring-ink ring-offset-1' : ''}`}
          >
            <span className="text-sm font-semibold">{s.name ?? s.code}</span>
            <span className="text-xs text-subtle">{s.code}</span>
            <span className="mt-auto text-xs">
              {s.occupancy > 0 ? (
                <>
                  <span className="font-mono font-semibold">{s.plate}</span>
                  {s.capacity > 1 && ` · ${s.occupancy}/${s.capacity}`}
                </>
              ) : (
                `frei${s.capacity > 1 ? ` · 0/${s.capacity}` : ''}`
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
