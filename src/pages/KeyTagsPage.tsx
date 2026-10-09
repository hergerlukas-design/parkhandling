import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { ErrorList } from '../components/ui'
import { hasKeyTag, keyTagQr, loadBoard, type BoardSlot } from '../lib/siteplan'
import { AREA_LABEL, type LocationArea } from '../types/domain'

const AREAS: LocationArea[] = ['hall', 'outdoor_a', 'outdoor_b']

/**
 * Druckbogen für die Schlüsselanhänger: ein Etikett je Stellplatz in Halle und Außenfläche
 * mit Stellplatz-Code und QR-Code (PF-KEY:<Code>). Etikettenraster 3 × 7 auf A4 (63,5 × 38,1 mm).
 */
export function KeyTagsPage() {
  const [slots, setSlots] = useState<BoardSlot[]>([])
  const [qr, setQr] = useState<Record<string, string>>({})
  const [areas, setAreas] = useState<LocationArea[]>(AREAS)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBoard()
      .then(async (board) => {
        const tagged = board.filter((s) => hasKeyTag(s.code))
        const svgs = await Promise.all(
          tagged.map((s) => QRCode.toString(keyTagQr(s.code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })),
        )
        setQr(Object.fromEntries(tagged.map((s, i) => [s.code, svgs[i]])))
        setSlots(tagged)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const shown = useMemo(() => slots.filter((s) => areas.includes(s.area)), [slots, areas])
  const toggle = (a: LocationArea) => setAreas((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]))

  return (
    <div className="min-h-full bg-ground print:bg-white">
      <style>{'@page { size: A4; margin: 15mm 7mm; }'}</style>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 print:hidden">
        <Link to="/einstellungen" className="touch-target inline-flex items-center gap-1 text-sm text-subtle">
          <Icon name="close" className="size-5" /> Zurück
        </Link>
        <h1 className="text-lg font-semibold">Schlüsselanhänger drucken</h1>
        <div className="flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <label key={a} className="touch-target inline-flex items-center gap-2 rounded-lg border border-line-strong px-3 text-sm">
              <input type="checkbox" checked={areas.includes(a)} onChange={() => toggle(a)} />
              {AREA_LABEL[a]}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={shown.length === 0}
          onClick={() => window.print()}
          className="touch-target ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {shown.length} Anhänger drucken
        </button>
      </header>
      <p className="px-4 pt-3 text-sm text-subtle print:hidden">
        Ein Anhänger je Stellplatz. Der Schlüssel hängt immer am Anhänger des Platzes, auf dem das Fahrzeug steht.
        Etiketten 63,5 × 38,1 mm (3 × 7 je A4-Bogen), Druck in Originalgröße ohne Skalierung.
      </p>
      {error && <div className="p-4"><ErrorList errors={[error]} /></div>}
      {slots.length === 0 && !error && <p className="p-4 text-sm text-muted">Lädt …</p>}
      <div className="grid grid-cols-[repeat(3,63.5mm)] justify-center gap-x-[2.5mm] p-4 print:p-0">
        {shown.map((s) => (
          <div
            key={s.code}
            className="flex h-[38.1mm] break-inside-avoid items-center gap-[3mm] overflow-hidden border border-dashed border-line bg-white px-[3mm] text-black print:border-transparent"
          >
            <div className="size-[30mm] shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr[s.code] ?? '' }} />
            <div className="min-w-0">
              <div className="font-mono text-[22pt] leading-none font-bold">{s.code}</div>
              <div className="mt-[2mm] text-[8pt] text-neutral-600">Schlüssel · {AREA_LABEL[s.area]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
