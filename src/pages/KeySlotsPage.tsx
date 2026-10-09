import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { ErrorList } from '../components/ui'
import { hasKeySlot, loadBoard, type BoardSlot } from '../lib/siteplan'
import { AREA_LABEL, type LocationArea } from '../types/domain'

const AREAS: LocationArea[] = ['hall', 'outdoor_a', 'outdoor_b']

/**
 * Stellplätze und Schlüsselfächer (Issue #16): je Stellplatz in Halle und Außenfläche genau ein Fach,
 * Fach-Code = Stellplatz-Code. Liste zum Nachschlagen und Etikettenbogen mit QR-Code (PF-LOC:<Code>)
 * für Stellplatz-Schild und Fach. Etikettenraster 3 × 7 auf A4 (63,5 × 38,1 mm).
 */
export function KeySlotsPage() {
  const [slots, setSlots] = useState<BoardSlot[]>([])
  const [qr, setQr] = useState<Record<string, string>>({})
  const [areas, setAreas] = useState<LocationArea[]>(AREAS)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBoard()
      .then(async (board) => {
        const withSlot = board.filter((s) => hasKeySlot(s.code))
        const svgs = await Promise.all(
          withSlot.map((s) =>
            QRCode.toString(s.qr_code ?? `PF-LOC:${s.code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
          ),
        )
        setQr(Object.fromEntries(withSlot.map((s, i) => [s.code, svgs[i]])))
        setSlots(withSlot)
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
        <h1 className="text-lg font-semibold">Stellplätze & Schlüsselfächer</h1>
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
          {shown.length} Etiketten drucken
        </button>
      </header>
      {error && <div className="p-4"><ErrorList errors={[error]} /></div>}
      {slots.length === 0 && !error && <p className="p-4 text-sm text-muted">Lädt …</p>}

      {slots.length > 0 && (
        <section className="p-4 print:hidden">
          <p className="mb-3 text-sm text-subtle">
            Jeder Stellplatz hat genau ein Schlüsselfach mit demselben Code. Der Schlüssel liegt im Fach des Platzes, auf dem
            das Fahrzeug steht. Zweitschlüssel kommen ins selbe Fach, mit dem Kennzeichen am Anhänger.
          </p>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ground text-xs font-semibold text-subtle">
                <tr>
                  <th className="px-4 py-2">Fach</th>
                  <th className="px-3 py-2">Stellplatz</th>
                  <th className="px-3 py-2">Bereich</th>
                  <th className="px-3 py-2">Fahrzeug</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.code} className="border-t border-line">
                    <td className="px-4 py-1.5 font-mono font-semibold">{s.code}</td>
                    <td className="px-3 py-1.5 font-mono">{s.code}</td>
                    <td className="px-3 py-1.5">{AREA_LABEL[s.area]}</td>
                    <td className="px-3 py-1.5 font-mono">{s.plate ?? <span className="font-sans text-muted">frei</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="mt-5 text-sm font-semibold">Etiketten für Stellplatz-Schild und Fach</h2>
          <p className="text-sm text-subtle">
            63,5 × 38,1 mm, 3 × 7 je A4-Bogen. In Originalgröße ohne Skalierung drucken.
          </p>
        </section>
      )}

      <div className="grid grid-cols-[repeat(3,63.5mm)] justify-center gap-x-[2.5mm] p-4 print:p-0">
        {shown.map((s) => (
          <div
            key={s.code}
            className="flex h-[38.1mm] break-inside-avoid items-center gap-[3mm] overflow-hidden border border-dashed border-line bg-white px-[3mm] text-black print:border-transparent"
          >
            <div className="size-[30mm] shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr[s.code] ?? '' }} />
            <div className="min-w-0">
              <div className="font-mono text-[22pt] leading-none font-bold">{s.code}</div>
              <div className="mt-[2mm] text-[8pt] text-neutral-600">Stellplatz & Fach · {AREA_LABEL[s.area]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
