import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Icon } from '../components/Icon'
import { HallGrid } from '../components/siteplan/HallGrid'
import { MoveDialog } from '../components/siteplan/MoveDialog'
import { OutdoorGrid, WorkAreas } from '../components/siteplan/OutdoorGrid'
import { SlotPanel } from '../components/siteplan/SlotPanel'
import { Legend } from '../components/siteplan/SlotTile'
import { formatDate } from '../lib/format'
import { loadBoard, subscribeBoard, type BoardSlot } from '../lib/siteplan'

type Tab = 'hall' | 'outdoor' | 'work'

interface Conflict {
  rack: number
  text: string
}

/** Konflikte je Regalspalte: unten steht ein Fahrzeug, das später abgeholt wird als eines darüber. */
function findConflicts(hall: BoardSlot[]): Conflict[] {
  const out: Conflict[] = []
  const racks = [...new Set(hall.map((s) => s.rack!))].sort((a, b) => a - b)
  for (const rack of racks) {
    const col = hall.filter((s) => s.rack === rack && s.booking_id && s.end_at).sort((a, b) => a.level! - b.level!)
    for (const upper of col) {
      const blocker = col.find((lower) => lower.level! < upper.level! && lower.end_at! > upper.end_at!)
      if (blocker) {
        out.push({
          rack,
          text: `R${rack}: ${upper.plate} (E${upper.level}) wird am ${formatDate(upper.end_at!).slice(0, 6)} abgeholt, also vor ${blocker.plate} (E${blocker.level}, ${formatDate(blocker.end_at!).slice(0, 6)}). Umsetzen vor dem ${formatDate(upper.end_at!).slice(0, 6)} einplanen – Umsetz-Aufgabe ist angelegt.`,
        })
      }
    }
  }
  return out
}

function CapacityPill({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-chip px-3 py-1 text-sm">
      <strong>{label}</strong>
      <span className="font-mono">{used}/{total}</span>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-surface sm:inline-block">
        <span className="block h-full bg-accent" style={{ width: `${total ? (used / total) * 100 : 0}%` }} />
      </span>
    </span>
  )
}

export function SitePlanPage() {
  const [params, setParams] = useSearchParams()
  const [slots, setSlots] = useState<BoardSlot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('hall')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [move, setMove] = useState<'checkout' | 'relocate' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(() => {
    loadBoard().then(setSlots).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
    return subscribeBoard(reload)
  }, [reload])

  // ?platz=R3-E1 → Platz vorauswählen (z. B. aus der Fahrzeug-Detailansicht)
  useEffect(() => {
    const code = params.get('platz')
    if (!code || slots.length === 0) return
    const slot = slots.find((s) => s.code === code)
    if (slot) {
      setSelectedId(slot.id)
      setTab(slot.area === 'hall' ? 'hall' : slot.area.startsWith('outdoor') ? 'outdoor' : 'work')
    }
  }, [params, slots])

  const hall = useMemo(() => slots.filter((s) => s.area === 'hall'), [slots])
  const outdoor = useMemo(() => slots.filter((s) => s.area === 'outdoor_a' || s.area === 'outdoor_b'), [slots])
  const conflicts = useMemo(() => findConflicts(hall), [hall])
  const selected = slots.find((s) => s.id === selectedId) ?? null

  const blockedBy = useMemo(() => {
    if (!selected || selected.area !== 'hall') return null
    const below = hall.filter((s) => s.rack === selected.rack && s.level! < selected.level! && s.booking_id)
    return below.length ? below.map((s) => `${s.plate} (E${s.level})`).join(', ') : null
  }, [selected, hall])

  function select(slot: BoardSlot) {
    setSelectedId(slot.id)
    setNotice(null)
    if (params.get('platz')) setParams({}, { replace: true })
  }

  const panel = selected && (
    <SlotPanel
      slot={selected}
      blockedBy={blockedBy}
      onClose={() => setSelectedId(null)}
      onCheckout={() => setMove('checkout')}
      onRelocate={() => setMove('relocate')}
    />
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="mx-auto flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-chip p-1" role="tablist">
            {([['hall', 'Halle · Regale'], ['outdoor', 'Außen'], ['work', 'Arbeitsorte']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`touch-target rounded-lg px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-surface shadow-sm' : 'text-subtle'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <CapacityPill label="Halle" used={hall.filter((s) => s.booking_id).length} total={hall.length} />
            <CapacityPill label="Außen" used={outdoor.filter((s) => s.booking_id).length} total={outdoor.length} />
          </div>
        </div>

        {tab !== 'work' && <Legend />}
        {error && <p className="text-sm text-danger">{error}</p>}
        {notice && <p className="rounded-xl bg-ok-soft px-4 py-2 text-sm text-ok-ink">{notice}</p>}

        {tab === 'hall' &&
          conflicts.map((c, i) => (
            <div key={i} role="alert" className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
              <Icon name="warning" className="mt-0.5 size-5 shrink-0" />
              <span>{c.text}</span>
            </div>
          ))}

        {tab === 'hall' && (
          <>
            <HallGrid slots={hall} conflictRacks={new Set(conflicts.map((c) => c.rack))} selectedId={selectedId} onSelect={select} />
            <p className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
              <span>↓ Einlagern: oben zuerst (E2 → E1)</span>
              <span>↑ Auslagern: unten zuerst (E1 → E2)</span>
              <span>Früheste Abholung gehört nach unten.</span>
            </p>
          </>
        )}
        {tab === 'outdoor' && <OutdoorGrid slots={outdoor} selectedId={selectedId} onSelect={select} />}
        {tab === 'work' && <WorkAreas slots={slots} selectedId={selectedId} onSelect={select} />}
        <div className="h-48 md:hidden" aria-hidden="true" />
      </div>

      {/* Detailpanel: rechts (Tablet) */}
      {selected && (
        <aside className="hidden w-80 shrink-0 border-l border-line bg-surface p-5 md:block">{panel}</aside>
      )}
      {/* Bottom-Sheet (Smartphone) */}
      {selected && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 max-h-[60dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 shadow-2xl md:hidden">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
          {panel}
        </div>
      )}

      {move && selected?.booking_id && (
        <MoveDialog
          bookingId={selected.booking_id}
          plate={selected.plate ?? ''}
          fromCode={selected.code}
          mode={move}
          onClose={() => setMove(null)}
          onDone={(res) => {
            setMove(null)
            setSelectedId(null)
            setNotice(`${selected.plate}: ${res.from ?? '–'} → ${res.to ?? 'übergeben'}`)
            reload()
          }}
        />
      )}
    </div>
  )
}
