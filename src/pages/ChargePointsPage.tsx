import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { ErrorList } from '../components/ui'
import { listChargePoints, type ChargePoint } from '../lib/charging/charging'

/**
 * QR-Aufkleber für die Ladepunkte (PF-CHG:<Code>). Werden in der Aufgabe „Laden“ gescannt; der QR-Code
 * auf dem Display der Kempower-Säule gilt nur für einen Ladevorgang und taugt dafür nicht.
 * Gleiches Etikettenraster wie die Stellplätze: 63,5 × 38,1 mm, 3 × 7 je A4.
 */
export function ChargePointsPage() {
  const [points, setPoints] = useState<ChargePoint[]>([])
  const [qr, setQr] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listChargePoints()
      .then(async (list) => {
        const active = list.filter((p) => p.active)
        const svgs = await Promise.all(
          active.map((p) => QRCode.toString(p.qr_code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })),
        )
        setQr(Object.fromEntries(active.map((p, i) => [p.code, svgs[i]])))
        setPoints(active)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="min-h-full bg-ground print:bg-white">
      <style>{'@page { size: A4; margin: 15mm 7mm; }'}</style>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 print:hidden">
        <Link to="/einstellungen" className="touch-target inline-flex items-center gap-1 text-sm text-subtle">
          <Icon name="close" className="size-5" /> Zurück
        </Link>
        <h1 className="text-lg font-semibold">Ladepunkte: QR-Aufkleber</h1>
        <button
          type="button"
          disabled={points.length === 0}
          onClick={() => window.print()}
          className="touch-target ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {points.length} Etiketten drucken
        </button>
      </header>
      {error && <div className="p-4"><ErrorList errors={[error]} /></div>}
      <p className="p-4 text-sm text-subtle print:hidden">
        Aufkleber gut sichtbar am Stecker bzw. Kabelhalter anbringen. In der Aufgabe „Laden“ wird dieser Code gescannt,
        nicht der QR-Code auf dem Display der Säule. 63,5 × 38,1 mm, in Originalgröße ohne Skalierung drucken.
      </p>
      <div className="grid grid-cols-[repeat(3,63.5mm)] justify-center gap-x-[2.5mm] p-4 print:p-0">
        {points.map((p) => (
          <div
            key={p.code}
            className="flex h-[38.1mm] break-inside-avoid items-center gap-[3mm] overflow-hidden border border-dashed border-line bg-white px-[3mm] text-black print:border-transparent"
          >
            <div className="size-[30mm] shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr[p.code] ?? '' }} />
            <div className="min-w-0">
              <div className="font-mono text-[22pt] leading-none font-bold">{p.code}</div>
              <div className="mt-[2mm] text-[8pt] text-neutral-600">Ladepunkt{p.label ? ` · ${p.label}` : ''}</div>
              <div className="text-[7pt] text-neutral-500">In der Aufgabe „Laden“ scannen</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
