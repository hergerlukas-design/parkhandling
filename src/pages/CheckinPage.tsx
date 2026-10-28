import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Icon } from '../components/Icon'
import { HallGrid } from '../components/siteplan/HallGrid'
import { OutdoorGrid, WorkAreas } from '../components/siteplan/OutdoorGrid'
import { Legend } from '../components/siteplan/SlotTile'
import { Button, ErrorList, TextInput } from '../components/ui'
import { formatPickup } from '../lib/due'
import { formatDate } from '../lib/format'
import { getProtocol } from '../lib/protocols'
import {
  getCheckinCandidate,
  keyHint,
  listCheckinCandidates,
  loadBoard,
  moveVehicle,
  recommendedSuggestion,
  subscribeBoard,
  suggestLocations,
  type BoardSlot,
  type CheckinCandidate,
  type Suggestion,
} from '../lib/siteplan'
import { useUpdateBlocker } from '../lib/update/updateGuard'
import { PARKING_TYPE_LABEL } from '../types/domain'

type Step = 'vehicle' | 'place'
type PlanTab = 'hall' | 'outdoor' | 'work'

const PLAN_TABS: [PlanTab, string][] = [['hall', 'Halle'], ['outdoor', 'Außen'], ['work', 'Arbeitsorte']]

function tabOf(area: BoardSlot['area']): PlanTab {
  return area === 'hall' ? 'hall' : area === 'outdoor_a' || area === 'outdoor_b' ? 'outdoor' : 'work'
}

type IntakeState = 'none' | 'draft' | 'final' | null

function Stepper({ step, intake }: { step: Step; intake: IntakeState }) {
  const items: [string, boolean, boolean][] = [
    ['Protokoll', false, intake === 'final'],
    ['Platz wählen', step === 'place', false],
  ]
  return (
    <ol className="hidden items-center gap-4 text-sm lg:flex">
      {items.map(([label, active, done]) => (
        <li key={label} className={`flex items-center gap-2 ${active ? 'font-semibold' : 'text-muted'}`}>
          <span className={`flex size-6 items-center justify-center rounded-full text-xs ${done ? 'bg-ok text-white' : active ? 'bg-accent text-white' : 'bg-chip'}`}>
            {done ? '✓' : active ? '•' : ''}
          </span>
          {label}
        </li>
      ))}
    </ol>
  )
}

export function CheckinPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [booking, setBooking] = useState<CheckinCandidate | null>(null)
  const [candidates, setCandidates] = useState<CheckinCandidate[]>([])
  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [chosen, setChosen] = useState<string | null>(params.get('platz'))
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[] | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [intake, setIntake] = useState<IntakeState>(null)
  const [board, setBoard] = useState<BoardSlot[]>([])
  const [tab, setTab] = useState<PlanTab>('hall')

  const step: Step = !booking ? 'vehicle' : 'place'
  useUpdateBlocker(!!booking && !warnings, 'Check-in')

  // Annahmeprotokoll der gewählten Buchung
  useEffect(() => {
    setIntake(null)
    if (!booking) return
    getProtocol(booking.id, 'intake')
      .then((p) => setIntake(p ? p.status : 'none'))
      .catch(() => setIntake(null))
  }, [booking])

  // Buchung aus URL übernehmen
  useEffect(() => {
    const id = params.get('booking')
    if (id) getCheckinCandidate(id).then((b) => b && setBooking(b)).catch((e: Error) => setErrors([e.message]))
  }, [params])

  useEffect(() => {
    if (booking) return
    const t = setTimeout(() => {
      listCheckinCandidates(search).then(setCandidates).catch((e: Error) => setErrors([e.message]))
    }, 200)
    return () => clearTimeout(t)
  }, [search, booking])

  // Platzvorschläge sofort nach der Fahrzeugwahl laden
  useEffect(() => {
    if (!booking) return
    let cancelled = false
    suggestLocations(booking)
      .then((list) => {
        if (cancelled) return
        setSuggestions(list)
        setChosen((c) => c ?? recommendedSuggestion(list)?.code ?? null)
      })
      .catch((e: Error) => !cancelled && setErrors([e.message]))
    return () => {
      cancelled = true
    }
  }, [booking])

  // Lageplan für die Platzwahl (live)
  useEffect(() => {
    if (!booking) return
    const reload = () => loadBoard().then(setBoard).catch((e: Error) => setErrors([e.message]))
    reload()
    return subscribeBoard(reload)
  }, [booking])

  const boardReady = board.length > 0
  // Reiter nach gewähltem Platz, sonst nach Parkart
  useEffect(() => {
    if (!booking) return
    const slot = chosen ? board.find((b) => b.code === chosen) : null
    setTab(slot ? tabOf(slot.area) : booking.parking_type === 'indoor' ? 'hall' : 'outdoor')
  }, [booking, boardReady]) // nur bei Fahrzeugwechsel bzw. erstem Laden, nicht bei jedem Live-Update

  // Vorgeschlagenes Feld einmal in den sichtbaren Bereich holen (Smartphone: Plan ist lang)
  const [scrolledFor, setScrolledFor] = useState<string | null>(null)
  useEffect(() => {
    if (!booking || !boardReady || !chosen || scrolledFor === booking.id) return
    const t = setTimeout(() => {
      // Halle gibt es doppelt (Tablet-Tabelle und Smartphone-Liste): das sichtbare Feld nehmen
      const tiles = [...document.querySelectorAll<HTMLElement>(`[aria-label^="${CSS.escape(chosen)} "]`)]
      tiles.find((el) => el.offsetParent !== null)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setScrolledFor(booking.id)
    }, 100)
    return () => clearTimeout(t)
  }, [booking, boardReady, chosen, scrolledFor, tab])

  const hall = useMemo(() => board.filter((b) => b.area === 'hall'), [board])
  const outdoor = useMemo(() => board.filter((b) => b.area === 'outdoor_a' || b.area === 'outdoor_b'), [board])
  const chosenSlot = chosen ? board.find((b) => b.code === chosen) ?? null : null
  const chosenSuggestion = chosen ? suggestions.find((x) => x.code === chosen) ?? null : null

  function pick(slot: BoardSlot) {
    setErrors([])
    const sug = suggestions.find((x) => x.code === slot.code)
    if (slot.occupancy >= slot.capacity) setErrors([`${slot.code} ist belegt${slot.plate ? ` (${slot.plate})` : ''}.`])
    else if (slot.status === 'blocked' || sug?.kind === 'relocate') setErrors([`${slot.code} ist nur mit Umsetzen erreichbar.`])
    else if (slot.area === 'transit') setErrors(['„Unterwegs“ ist kein Stellplatz.'])
    else setChosen(slot.code)
  }

  const recommended = suggestions.find((s) => s.kind === 'fits')?.code ?? null
  const openServices = booking?.open_task_count ?? 0
  const openNames = useMemo(
    () => (booking?.task_chips ?? []).filter((c) => c.status !== 'done').map((c) => c.title).join(' · '),
    [booking],
  )

  async function confirm(code: string, reason = 'Einlagern') {
    if (!booking) return
    setBusy(true)
    setErrors([])
    try {
      const res = await moveVehicle(booking.id, code, reason)
      const extra = recommended && code !== recommended && booking.parking_type === 'indoor' && reason === 'Einlagern'
        ? [`Abweichung vom Vorschlag ${recommended}.`]
        : []
      const all = [...extra, ...res.warnings]
      const keyTodo = keyHint(res.from, res.to)
      if (all.length || keyTodo) {
        setHint(keyTodo)
        setWarnings(all)
      } else navigate(`/fahrzeuge/${booking.id}`)
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setBusy(false)
    }
  }

  async function firstPrep() {
    const board = await loadBoard()
    const target = board.find((s) => (s.code === 'W-AUF1' || s.code === 'W-AUF2') && s.occupancy < s.capacity)
    if (!target) {
      setErrors(['Beide Aufbereitungsplätze sind belegt.'])
      return
    }
    await confirm(target.code, 'Erst Aufbereitung')
  }

  if (warnings && booking) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold">{booking.plate} eingecheckt</h1>
        {hint && <p className="rounded-xl bg-accent-soft px-4 py-3 text-lg font-semibold text-accent-dark">{hint}</p>}
        {warnings.length > 0 && (
          <ul className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn-ink">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate(`/fahrzeuge/${booking.id}`)}>Zum Fahrzeug</Button>
          <Button onClick={() => navigate('/lageplan')}>Lageplan</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-line bg-surface px-4 py-3 md:px-6">
        <Link to="/lageplan" className="touch-target inline-flex items-center gap-1 text-sm text-subtle">
          <Icon name="close" className="size-5" /> Abbrechen
        </Link>
        <h1 className="text-lg font-semibold">Fahrzeug einchecken</h1>
        <div className="ml-auto"><Stepper step={step} intake={intake} /></div>
      </header>

      <div className="grid flex-1 gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        {/* Linke Spalte: Fahrzeug, Hinweise */}
        <div className="flex flex-col gap-4">
          {booking ? (
            <section className="rounded-2xl border border-line bg-surface p-4">
              {intake === 'final' && <p className="text-xs text-subtle">Annahmeprotokoll unterschrieben</p>}
              <div className="mt-1 font-mono text-3xl font-bold">{booking.plate}</div>
              <div className="text-subtle">{[booking.vehicle_model, booking.external_ref && `Buchung ${booking.external_ref}`].filter(Boolean).join(' · ')}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-white">{PARKING_TYPE_LABEL[booking.parking_type]}</span>
                <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-semibold text-ok-ink">Abholung {formatPickup(booking.end_at)}</span>
              </div>
              {intake && intake !== 'final' && (
                <Link to={`/protokoll/annahme/${booking.id}`}
                  className="touch-target mt-3 flex items-center justify-between gap-2 rounded-xl border border-warn bg-warn-soft px-3 py-2 text-sm text-warn-ink">
                  <span>{intake === 'draft' ? 'Annahmeprotokoll angefangen, noch nicht unterschrieben' : 'Annahmeprotokoll fehlt noch'}</span>
                  <span className="font-semibold">{intake === 'draft' ? 'Fortsetzen' : 'Erstellen'}</span>
                </Link>
              )}
              {booking.task_chips.length > 0 && (
                <p className="mt-3 text-sm"><span className="font-semibold">Gebuchte Leistungen</span><br />{booking.task_chips.map((c) => c.title).join(' · ')}</p>
              )}
              <button type="button" className="mt-2 text-xs text-accent underline" onClick={() => { setBooking(null); setChosen(null); setSuggestions([]) }}>
                Anderes Fahrzeug
              </button>
            </section>
          ) : (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 font-semibold">{chosen ? `Welches Fahrzeug kommt auf ${chosen}?` : 'Welches Fahrzeug?'}</h2>
              <TextInput placeholder="Kennzeichen, Kunde oder Buchungsnummer" value={search} onChange={(e) => setSearch(e.target.value)} />
              <ul className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setBooking(c)}
                      className="touch-target flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-ground">
                      <span>
                        <span className="font-mono font-semibold">{c.plate}</span>
                        <span className="ml-2 text-sm text-subtle">{c.vehicle_model ?? c.customer_name}</span>
                      </span>
                      <span className="text-xs text-muted">Anreise {formatDate(c.start_at).slice(0, 6)}</span>
                    </button>
                  </li>
                ))}
                {candidates.length === 0 && <li className="px-2 py-3 text-sm text-muted">Keine offenen Ankünfte gefunden.</li>}
              </ul>
            </section>
          )}

          {step === 'place' && openServices > 0 && booking?.parking_type === 'indoor' && (
            <section className="rounded-2xl bg-warn-soft p-4 text-sm text-warn-ink">
              <h2 className="font-semibold">{openServices} Leistung{openServices === 1 ? '' : 'en'} offen</h2>
              <p className="mt-1">{openNames}. Wird das Fahrzeug jetzt auf E2/E3 eingelagert, kostet jede spätere Arbeit Umsetzvorgänge. Empfehlung: erst Aufbereitung, dann einlagern.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void firstPrep()}
                  className="touch-target rounded-lg bg-warn-ink px-4 py-2 font-semibold text-white">Erst Aufbereitung</button>
              </div>
            </section>
          )}

          {step === 'vehicle' && <ErrorList errors={errors} />}
        </div>

        {/* Rechte Spalte: Platzwahl im Lageplan */}
        {step === 'place' && (
          <section className="flex min-w-0 flex-col gap-3 pb-28 md:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Platz wählen</h2>
              <div className="inline-flex rounded-xl bg-chip p-1" role="tablist">
                {PLAN_TABS.map(([t, label]) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`touch-target rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? 'bg-surface shadow-sm' : 'text-subtle'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {recommended && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="text-subtle">Vorschlag:</span>
                <button type="button" onClick={() => { setChosen(recommended); const sl = board.find((b) => b.code === recommended); if (sl) setTab(tabOf(sl.area)) }}
                  className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono font-semibold text-accent-dark">
                  {recommended}
                </button>
                <span className="text-subtle">{suggestions.find((x) => x.code === recommended)?.reason}</span>
              </p>
            )}

            {tab !== 'work' && <Legend />}
            {board.length === 0 && <p className="text-sm text-muted">Lageplan lädt …</p>}
            {tab === 'hall' && hall.length > 0 && (
              <HallGrid slots={hall} conflictRacks={new Set()} selectedId={chosenSlot?.id ?? null} onSelect={pick} />
            )}
            {tab === 'outdoor' && outdoor.length > 0 && (
              <OutdoorGrid slots={outdoor} selectedId={chosenSlot?.id ?? null} onSelect={pick} />
            )}
            {tab === 'work' && board.length > 0 && (
              <WorkAreas slots={board} selectedId={chosenSlot?.id ?? null} onSelect={pick} />
            )}

            {/* Bestätigen: auf dem Smartphone fest über der Navigation */}
            <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 shadow-2xl md:static md:mt-auto md:justify-end md:border-0 md:bg-transparent md:p-0 md:pt-2 md:shadow-none">
              <span className="min-w-0 flex-1 text-sm md:flex-none md:text-right">
                {errors.length > 0 ? (
                  <span role="alert" className="block text-danger">{errors[errors.length - 1]}</span>
                ) : chosen ? (
                  <>
                    <span className="font-mono font-semibold">{chosen}</span>
                    {chosenSuggestion && chosenSuggestion.kind !== 'fits' && (
                      <span className="block text-xs text-warn-ink">{chosenSuggestion.reason}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">Freies Feld im Plan antippen</span>
                )}
              </span>
              <Button variant="primary" disabled={!chosen || busy} onClick={() => chosen && void confirm(chosen)}>
                {busy ? 'Speichert …' : chosen ? `${chosen} bestätigen` : 'Platz wählen'}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
