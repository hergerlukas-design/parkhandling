import { APPEARANCE_OPTIONS, appearanceStore, setAppearance } from '../../lib/appearance'
import { useStore } from '../../lib/store'

/** Umschalter Standard ↔ Website-Design; gilt nur für dieses Gerät */
export function AppearanceSettings() {
  const current = useStore(appearanceStore)
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Darstellung" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {APPEARANCE_OPTIONS.map((o) => {
          const on = current === o.id
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setAppearance(o.id)}
              className={`touch-target flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left ${
                on ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:bg-ground'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className={`size-3.5 rounded-full border-2 ${on ? 'border-accent bg-accent' : 'border-line-strong'}`}
                />
                {o.label}
              </span>
              <span className="text-xs text-muted">{o.text}</span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted">Gilt nur für dieses Gerät.</p>
    </div>
  )
}
