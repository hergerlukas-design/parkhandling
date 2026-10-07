import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DAMAGE_VIEWS, INTERIOR, viewOf, viewsWith, type DamageView } from '../../lib/damageZones'

// Schadensgrafik aus dem ADE Fleet Manager: fünf Ansichten (Oben, Vorne, Hinten,
// Links, Rechts) mit antippbaren Zonen plus Innenraum. Die aktive Position ist
// hervorgehoben, Positionen weiterer Schäden sind rot markiert.

type ZoneState = 'active' | 'marked' | 'idle'

interface Props {
  value: string
  onChange?: (pos: string) => void
  /** Positionen weiterer Schäden – als markierte Zonen dargestellt */
  markers?: string[]
  /** Nur anzeigen (abgeschlossenes Protokoll) */
  readOnly?: boolean
}

// Kurzbeschriftungen in der Grafik ("|" = Zeilenumbruch)
const SHORT: Record<string, string> = {
  'Motorhaube': 'Motor-|haube', 'Dach': 'Dach',
  'Spiegel links': 'Spiegel|links', 'Spiegel rechts': 'Spiegel|rechts',
  'Frontscheibe': 'Front-|scheibe',
  'Scheinwerfer links': 'Schein-|werfer|li.', 'Scheinwerfer rechts': 'Schein-|werfer|re.',
  'Stoßfänger vorne': 'Stoßf.|vorne', 'Kennzeichen vorne': 'KZ|vorne',
  'Heckscheibe': 'Heck-|scheibe',
  'Rückleuchte links': 'Rückl.|links', 'Rückleuchte rechts': 'Rückl.|rechts',
  'Stoßfänger hinten': 'Stoßf.|hinten', 'Kennzeichen hinten': 'KZ|hinten',
  'Kotflügel vorne': 'Kotfl.|vorne', 'Kotflügel hinten': 'Kotfl.|hinten',
  'Seitenscheibe vorne': 'Scheibe|vorne', 'Seitenscheibe hinten': 'Scheibe|hinten',
  'Tür vorne': 'Tür|vorne', 'Tür hinten': 'Tür|hinten',
  'Reifen vorne': 'Reifen|vorne', 'Reifen hinten': 'Reifen|hinten',
  'Felge vorne': 'Felge|vorne', 'Felge hinten': 'Felge|hinten',
}

const COLORS: Record<ZoneState, { fill: string; stroke: string; text: string }> = {
  active: { fill: 'var(--color-warn-soft)', stroke: 'var(--color-warn)', text: 'var(--color-warn-ink)' },
  marked: { fill: 'var(--color-danger-soft)', stroke: 'var(--color-danger)', text: 'var(--color-danger-ink)' },
  idle: { fill: 'var(--color-chip)', stroke: 'var(--color-line-strong)', text: 'var(--color-subtle)' },
}

const OUTLINE = { fill: 'var(--color-surface)', stroke: 'var(--color-muted)', strokeWidth: 1.5 }
const DIVIDER = { stroke: 'var(--color-line)', strokeWidth: 1.5 }

interface Ctx {
  value: string
  markers: Set<string>
  onPick?: (pos: string) => void
}

function stateOf(pos: string, ctx: Ctx): ZoneState {
  if (pos === ctx.value) return 'active'
  if (ctx.markers.has(pos)) return 'marked'
  return 'idle'
}

type Shape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
  | { kind: 'polygon'; points: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }

/** Antippbare Zone mit Beschriftung */
function Zone({ pos, short = pos, shape, lx, ly, fontSize = 9, ctx }: {
  pos: string
  short?: string
  shape: Shape
  lx: number
  ly: number
  fontSize?: number
  ctx: Ctx
}) {
  const state = stateOf(pos, ctx)
  const c = COLORS[state]
  const pick = ctx.onPick
  const interactive = pick
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': pos,
        'aria-pressed': state === 'active',
        onClick: () => pick(pos),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            pick(pos)
          }
        },
        className: 'cursor-pointer outline-none focus-visible:[stroke-width:3]',
      }
    : { 'aria-label': pos }
  const style = { fill: c.fill, stroke: c.stroke, strokeWidth: 1.5 }
  const lines = (SHORT[short] ?? short).split('|')
  const lh = fontSize + 2
  return (
    <g>
      {shape.kind === 'rect' && <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx ?? 4} style={style} {...interactive} />}
      {shape.kind === 'polygon' && <polygon points={shape.points} style={style} {...interactive} />}
      {shape.kind === 'circle' && <circle cx={shape.cx} cy={shape.cy} r={shape.r} style={style} {...interactive} />}
      {lines.map((line, i) => (
        <text
          key={i}
          x={lx}
          y={ly + (i - (lines.length - 1) / 2) * lh}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={fontSize}
          fontWeight={state === 'idle' ? 500 : 700}
          style={{ fill: c.text, userSelect: 'none', pointerEvents: 'none' }}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

function Svg({ viewBox, label, children }: { viewBox: string; label: string; children: ReactNode }) {
  return (
    <svg viewBox={viewBox} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="group" aria-label={label}>
      {children}
    </svg>
  )
}

function TopView({ ctx }: { ctx: Ctx }) {
  return (
    <Svg viewBox="0 0 360 240" label="Ansicht oben">
      <path d="M 18,145 L 18,95 L 28,64 L 58,60 L 103,55 L 106,30 L 152,30 L 155,55 L 268,58 L 295,62 L 338,78 L 342,120 L 338,162 L 295,178 L 268,182 L 155,185 L 152,210 L 106,210 L 103,185 L 58,180 L 28,176 Z" style={OUTLINE} />
      <line x1="138" y1="68" x2="138" y2="172" style={DIVIDER} strokeDasharray="5 3" />
      <line x1="268" y1="68" x2="268" y2="172" style={DIVIDER} strokeDasharray="5 3" />
      <Zone ctx={ctx} pos="Motorhaube" shape={{ kind: 'polygon', points: '25,175 25,65 55,62 135,60 135,180 55,178' }} lx={80} ly={120} fontSize={11} />
      <Zone ctx={ctx} pos="Dach" shape={{ kind: 'rect', x: 155, y: 62, width: 110, height: 116 }} lx={210} ly={120} fontSize={13} />
      <Zone ctx={ctx} pos="Spiegel links" shape={{ kind: 'rect', x: 103, y: 178, width: 50, height: 34, rx: 3 }} lx={128} ly={195} fontSize={7.5} />
      <Zone ctx={ctx} pos="Spiegel rechts" shape={{ kind: 'rect', x: 103, y: 28, width: 50, height: 34, rx: 3 }} lx={128} ly={45} fontSize={7.5} />
    </Svg>
  )
}

const FRONT_REAR_OUTLINE =
  'M 110,15 L 190,15 L 225,26 L 230,58 L 275,60 L 276,130 L 268,162 L 32,162 L 24,130 L 25,60 L 70,58 L 75,26 Z'

function FrontView({ ctx }: { ctx: Ctx }) {
  return (
    <Svg viewBox="0 0 300 200" label="Ansicht vorne">
      <path d={FRONT_REAR_OUTLINE} style={OUTLINE} />
      <rect x={84} y={92} width={132} height={38} rx={4} style={{ fill: 'var(--color-ground)', stroke: 'var(--color-line)', strokeWidth: 1 }} />
      <Zone ctx={ctx} pos="Frontscheibe" shape={{ kind: 'polygon', points: '88,18 212,18 222,90 78,90' }} lx={150} ly={55} fontSize={10} />
      <Zone ctx={ctx} pos="Scheinwerfer links" shape={{ kind: 'polygon', points: '28,60 84,60 84,128 25,125' }} lx={56} ly={94} fontSize={8.5} />
      <Zone ctx={ctx} pos="Scheinwerfer rechts" shape={{ kind: 'polygon', points: '216,60 272,60 275,125 216,128' }} lx={244} ly={94} fontSize={8.5} />
      <Zone ctx={ctx} pos="Stoßfänger vorne" shape={{ kind: 'rect', x: 28, y: 133, width: 244, height: 26, rx: 6 }} lx={150} ly={146} fontSize={9.5} />
      <Zone ctx={ctx} pos="Kennzeichen vorne" shape={{ kind: 'rect', x: 112, y: 136, width: 76, height: 20, rx: 3 }} lx={150} ly={146} fontSize={8} />
    </Svg>
  )
}

function RearView({ ctx }: { ctx: Ctx }) {
  return (
    <Svg viewBox="0 0 300 200" label="Ansicht hinten">
      <path d={FRONT_REAR_OUTLINE} style={OUTLINE} />
      <Zone ctx={ctx} pos="Heckscheibe" shape={{ kind: 'polygon', points: '95,18 205,18 215,80 85,80' }} lx={150} ly={50} fontSize={10} />
      <Zone ctx={ctx} pos="Rückleuchte links" shape={{ kind: 'rect', x: 28, y: 60, width: 58, height: 68 }} lx={57} ly={94} />
      <Zone ctx={ctx} pos="Rückleuchte rechts" shape={{ kind: 'rect', x: 214, y: 60, width: 58, height: 68 }} lx={243} ly={94} />
      <Zone ctx={ctx} pos="Stoßfänger hinten" shape={{ kind: 'rect', x: 28, y: 133, width: 244, height: 26, rx: 6 }} lx={150} ly={146} fontSize={9.5} />
      <Zone ctx={ctx} pos="Kennzeichen hinten" shape={{ kind: 'rect', x: 108, y: 92, width: 84, height: 28, rx: 3 }} lx={150} ly={106} fontSize={8} />
    </Svg>
  )
}

const SIDE_OUTLINE =
  'M 30,168 L 30,138 C 32,118 45,108 60,105 ' +
  'L 62,58 C 62,22 78,12 152,12 ' +
  'L 285,10 C 395,10 415,12 428,16 ' +
  'L 510,58 L 512,168 ' +
  'L 462,168 A 40,40 0 0 0 382,168 ' +
  'L 143,168 A 40,40 0 0 0 63,168 Z'

/** x-Koordinaten der Seitenansicht; rechts gespiegelt */
const SIDE_X = {
  left: { fenderF: 55, fenderR: 420, front: 152, rear: 287, wheelF: 103, wheelR: 422 },
  right: { fenderF: 393, fenderR: 32, front: 258, rear: 125, wheelF: 437, wheelR: 118 },
}

function SideView({ side, ctx }: { side: 'left' | 'right'; ctx: Ctx }) {
  const sx = side === 'left' ? ' links' : ' rechts'
  const x = SIDE_X[side]
  return (
    <Svg viewBox="0 0 540 235" label={side === 'left' ? 'Ansicht links' : 'Ansicht rechts'}>
      <g transform={side === 'right' ? 'scale(-1,1) translate(-540,0)' : undefined}>
        <path d={SIDE_OUTLINE} style={OUTLINE} />
        <line x1="152" y1="95" x2="418" y2="95" style={DIVIDER} strokeDasharray="6 3" />
      </g>
      <Zone ctx={ctx} pos={`Kotflügel vorne${sx}`} short="Kotflügel vorne" shape={{ kind: 'rect', x: x.fenderF, y: 52, width: 92, height: 116 }} lx={x.fenderF + 46} ly={110} />
      <Zone ctx={ctx} pos={`Seitenscheibe vorne${sx}`} short="Seitenscheibe vorne" shape={{ kind: 'rect', x: x.front, y: 12, width: 130, height: 81 }} lx={x.front + 65} ly={53} />
      <Zone ctx={ctx} pos={`Tür vorne${sx}`} short="Tür vorne" shape={{ kind: 'rect', x: x.front, y: 95, width: 130, height: 71 }} lx={x.front + 65} ly={130} />
      <Zone ctx={ctx} pos={`Seitenscheibe hinten${sx}`} short="Seitenscheibe hinten" shape={{ kind: 'rect', x: x.rear, y: 12, width: 128, height: 81 }} lx={x.rear + 64} ly={53} />
      <Zone ctx={ctx} pos={`Tür hinten${sx}`} short="Tür hinten" shape={{ kind: 'rect', x: x.rear, y: 95, width: 128, height: 71 }} lx={x.rear + 64} ly={130} />
      <Zone ctx={ctx} pos={`Kotflügel hinten${sx}`} short="Kotflügel hinten" shape={{ kind: 'rect', x: x.fenderR, y: 52, width: 88, height: 116 }} lx={x.fenderR + 44} ly={110} />
      <Zone ctx={ctx} pos={`Reifen vorne${sx}`} short="Reifen vorne" shape={{ kind: 'circle', cx: x.wheelF, cy: 188, r: 44 }} lx={x.wheelF} ly={218} fontSize={7} />
      <Zone ctx={ctx} pos={`Felge vorne${sx}`} short="Felge vorne" shape={{ kind: 'circle', cx: x.wheelF, cy: 188, r: 20 }} lx={x.wheelF} ly={188} fontSize={7.5} />
      <Zone ctx={ctx} pos={`Reifen hinten${sx}`} short="Reifen hinten" shape={{ kind: 'circle', cx: x.wheelR, cy: 188, r: 44 }} lx={x.wheelR} ly={218} fontSize={7} />
      <Zone ctx={ctx} pos={`Felge hinten${sx}`} short="Felge hinten" shape={{ kind: 'circle', cx: x.wheelR, cy: 188, r: 20 }} lx={x.wheelR} ly={188} fontSize={7.5} />
    </Svg>
  )
}

export function CarDamageSelector({ value, onChange, markers = [], readOnly = false }: Props) {
  const markerSet = useMemo(() => new Set(markers), [markers])
  const [view, setView] = useState<DamageView>(() => viewOf(value) ?? 'top')

  // Bei geänderter Position (z. B. Entwurf wiederhergestellt) zur passenden Ansicht springen
  useEffect(() => {
    const v = viewOf(value)
    if (v) setView(v)
  }, [value])

  const markedViews = useMemo(() => viewsWith(markers), [markers])
  const ctx: Ctx = { value, markers: markerSet, onPick: readOnly ? undefined : onChange }
  const interiorState = stateOf(INTERIOR, ctx)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex border-b border-line" role="tablist" aria-label="Fahrzeugansicht">
        {DAMAGE_VIEWS.map(({ id, label }) => (
          // Kein <button>: Reiter bleiben auch im gesperrten <fieldset> (abgeschlossenes Protokoll) bedienbar
          <div
            key={id}
            role="tab"
            tabIndex={0}
            aria-selected={view === id}
            onClick={() => setView(id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setView(id)
              }
            }}
            className={`touch-target flex flex-1 cursor-pointer items-center justify-center py-1.5 text-xs font-semibold ${
              view === id ? '-mb-px border-b-2 border-accent text-accent' : 'text-muted'
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1">
              {label}
              {markedViews.has(id) && <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-label="enthält Schäden" />}
            </span>
          </div>
        ))}
      </div>

      <div className="h-[200px]">
        {view === 'top' && <TopView ctx={ctx} />}
        {view === 'front' && <FrontView ctx={ctx} />}
        {view === 'back' && <RearView ctx={ctx} />}
        {view === 'left' && <SideView side="left" ctx={ctx} />}
        {view === 'right' && <SideView side="right" ctx={ctx} />}
      </div>

      <button
        type="button"
        disabled={readOnly}
        aria-pressed={interiorState === 'active'}
        onClick={() => onChange?.(INTERIOR)}
        className={`touch-target w-full rounded-xl border py-2 text-sm font-medium disabled:cursor-default ${
          interiorState === 'active'
            ? 'border-warn bg-warn-soft text-warn-ink'
            : interiorState === 'marked'
              ? 'border-danger/50 bg-danger-soft text-danger-ink'
              : 'border-line text-muted'
        }`}
      >
        Innenraum
      </button>

      <p className={`px-1 text-xs font-semibold ${value ? 'text-warn-ink' : 'text-muted'}`}>
        {value ? `✓ ${value}` : readOnly ? 'Keine Position angegeben' : 'Position in der Grafik antippen'}
      </p>
    </div>
  )
}
