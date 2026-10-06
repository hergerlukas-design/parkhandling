import type { BoardSlot } from '../../lib/siteplan'
import { Icon } from '../Icon'
import { SlotTile } from './SlotTile'

const LEVELS = [3, 2, 1] as const

/**
 * Halle als Regalraster. Tablet: Spalten R1–Rn nebeneinander, Ebenen E3 (oben) bis E1 (unten).
 * Smartphone: eine Zeile je Regalspalte mit E1 links bis E3 rechts.
 */
export function HallGrid({
  slots,
  conflictRacks,
  selectedId,
  onSelect,
}: {
  slots: BoardSlot[]
  conflictRacks: Set<number>
  selectedId: string | null
  onSelect: (slot: BoardSlot) => void
}) {
  const racks = [...new Set(slots.map((s) => s.rack!))].sort((a, b) => a - b)
  const at = (rack: number, level: number) => slots.find((s) => s.rack === rack && s.level === level)

  return (
    <>
      {/* Tablet/Desktop */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface p-4 md:block">
        <table className="w-full border-separate border-spacing-2">
          <thead>
            <tr>
              <th className="w-14" />
              {racks.map((r) => (
                <th key={r} className={`text-center text-sm font-semibold ${conflictRacks.has(r) ? 'text-danger' : ''}`}>
                  <span className="inline-flex items-center gap-1">
                    R{r}
                    {conflictRacks.has(r) && <Icon name="warning" className="size-4" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((level) => (
              <tr key={level}>
                <th className="text-left align-middle text-sm font-semibold">
                  E{level}
                  <span className="block text-[11px] font-normal text-muted">{level === 3 ? 'oben' : level === 1 ? 'unten' : ''}</span>
                </th>
                {racks.map((r) => {
                  const slot = at(r, level)
                  return (
                    <td key={r} className="min-w-24 align-top">
                      {slot && <SlotTile slot={slot} selected={slot.id === selectedId} onSelect={onSelect} />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Smartphone */}
      <div className="md:hidden">
        <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 px-1 pb-1 text-xs font-semibold text-subtle">
          <span />
          <span>E1 unten</span>
          <span>E2</span>
          <span>E3 oben</span>
        </div>
        <div className="flex flex-col gap-2">
          {racks.map((r) => (
            <div key={r} className="grid grid-cols-[2.5rem_1fr_1fr_1fr] items-stretch gap-2">
              <span className={`self-center text-sm font-bold ${conflictRacks.has(r) ? 'text-danger' : ''}`}>R{r}</span>
              {[1, 2, 3].map((level) => {
                const slot = at(r, level)
                return slot ? <SlotTile key={level} slot={slot} compact selected={slot.id === selectedId} onSelect={onSelect} /> : <span key={level} />
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
