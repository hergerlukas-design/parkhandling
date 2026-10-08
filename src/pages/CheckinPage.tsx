import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Icon } from '../components/Icon'
import { QrScanner } from '../components/QrScanner'
import { Button, ErrorList, TextInput } from '../components/ui'
import { formatPickup } from '../lib/due'
import { formatDate } from '../lib/format'
import { getProtocol } from '../lib/protocols'
import {
  getCheckinCandidate,
  listCheckinCandidates,
  listFreeKeys,
  loadBoard,
  moveVehicle,
  parseScan,
  recommendedSuggestion,
  suggestLocations,
  type CheckinCandidate,
  type Suggestion,
} from '../lib/siteplan'
import { useUpdateBlocker } from '../lib/update/updateGuard'
import { PARKING_TYPE_LABEL } from '../types/domain'

type Step = 'vehicle' | 'key' | 'place'

const KIND_STYLE: Record<Suggestion['kind'], { badge: string; label: string; box: string; title: string }> = {
  fits: { badge: 'bg-accent-soft text-accent-dark', label: 'passt', box: 'border-solid border-accent', title: 'Passt' },
  conflict: { badge: 'bg-danger-soft text-danger-ink', label: 'Konflikt', box: 'border-dashed border-line-strong', title: 'Nicht geeignet' },
  relocate: { badge: 'bg-danger-soft text-danger-ink', label: 'gesperrt', box: 'border-dashed border-line-strong', title: 'Nur mit Umsetzen' },
  buffer: { badge: 'bg-chip text-subtle', label: 'Puffer', box: 'border-dashed border-line-strong', title: 'Pufferzone' },
}

type IntakeState = 'none' | 'draft' | 'final' | null

function Stepper({ step, intake }: { step: Step; intake: IntakeState }) {
  const items: [string, boolean, boolean][] = [
    ['Protokoll', false, intake === 'final'],
    ['Schlüssel', step === 'key', step === 'place'],
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
  const [keyCode, setKeyCode] = useState<string | null>(params.get('key'))
  const [freeKeys, setFreeKeys] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [chosen, setChosen] = useState<string | null>(params.get('platz'))
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [intake, setIntake] = useState<IntakeState>(null)

  const step: Step = !booking ? 'vehicle' : !keyCode ? 'key' : 'place'
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

  useEffect(() => {
    if (step === 'key') listFreeKeys(6).then(setFreeKeys).catch(() => undefined)
  }, [step])

  // Platzvorschläge sofort nach der Fahrzeugwahl laden, damit der empfohlene Platz
  // schon beim Schlüssel-Schritt sichtbar ist
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

  const recommended = suggestions.find((s) => s.kind === 'fits')?.code ?? null
  const recommendation = recommendedSuggestion(suggestions)
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
      const res = await moveVehicle(booking.id, code, reason, keyCode)
      const extra = recommended && code !== recommended && booking.parking_type === 'indoor' && reason === 'Einlagern'
        ? [`Abweichung vom Vorschlag ${recommended}.`]
        : []
      const all = [...extra, ...res.warnings]
      if (all.length) setWarnings(all)
      else navigate(`/fahrzeuge/${booking.id}`)
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setBusy(false)
    }
  }

  function onScan(raw: string) {
    const scan = parseScan(raw)
    setErrors([])
    if (step === 'key') {
      if (scan.kind === 'key') setKeyCode(scan.code)
      else setErrors([`„${scan.code}“ ist kein Schlüssel-QR-Code.`])
    } else if (step === 'place') {
      if (scan.kind === 'location') {
        setChosen(scan.code)
        void confirm(scan.code)
      } else setErrors([`„${scan.code}“ ist kein Stellplatz-QR-Code.`])
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
        <ul className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
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
        {/* Linke Spalte: Fahrzeug, Hinweise, Scanner */}
        <div className="flex flex-col gap-4">
          {booking ? (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-xs text-subtle">
                {keyCode ? `Schlüssel ${keyCode}` : 'Schlüssel noch nicht gescannt'}
                {intake === 'final' && ' · Annahmeprotokoll unterschrieben'}
              </p>
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
              {step === 'key' && recommendation && (
                <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-dark">
                  <span className="font-semibold">Empfohlener Platz {recommendation.code}</span> – {recommendation.reason}
                </p>
              )}
              {booking.task_chips.length > 0 && (
                <p className="mt-3 text-sm"><span className="font-semibold">Gebuchte Leistungen</span><br />{booking.task_chips.map((c) => c.title).join(' · ')}</p>
              )}
              <button type="button" className="mt-2 text-xs text-accent underline" onClick={() => { setBooking(null); setKeyCode(null); setChosen(null); setSuggestions([]) }}>
                Anderes Fahrzeug
              </button>
            </section>
          ) : (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 font-semibold">Welches Fahrzeug?</h2>
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

          {step === 'key' && (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 font-semibold">Schlüssel</h2>
              <p className="mb-2 text-sm text-subtle">Schlüsselanhänger scannen oder freies Fach wählen:</p>
              <div className="flex flex-wrap gap-2">
                {freeKeys.map((k) => (
                  <button key={k} type="button" onClick={() => setKeyCode(k)}
                    className="touch-target rounded-lg border border-line-strong px-3 py-2 font-mono text-sm font-semibold">{k}</button>
                ))}
              </div>
            </section>
          )}

          {(step === 'key' || step === 'place') && (
            <QrScanner onResult={onScan} label={step === 'key' ? 'Schlüssel-QR scannen' : 'Stellplatz-QR scannen zum Bestätigen'} />
          )}
          <ErrorList errors={errors} />
        </div>

        {/* Rechte Spalte: Platzwahl */}
        {step === 'place' && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Platz wählen</h2>
            {suggestions.map((s) => {
              const st = KIND_STYLE[s.kind]
              const isChosen = chosen === s.code
              return (
                <button key={s.code} type="button" onClick={() => setChosen(s.code)}
                  disabled={s.kind === 'relocate'}
                  className={`flex items-center gap-4 rounded-2xl border-2 bg-surface px-4 py-3 text-left ${st.box} ${isChosen ? 'ring-3 ring-accent ring-offset-1' : ''} ${s.kind !== 'fits' ? 'opacity-80' : ''} disabled:cursor-not-allowed`}>
                  <span className={`w-20 shrink-0 font-mono text-xl font-bold ${s.kind === 'fits' ? '' : 'text-muted'}`}>{s.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{s.code === recommended ? 'Empfohlen' : st.title}</span>
                    <span className="block text-sm text-subtle">{s.reason}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.badge}`}>{st.label}</span>
                </button>
              )
            })}
            {suggestions.length === 0 && <p className="text-sm text-muted">Lädt Vorschläge …</p>}
            <div className="mt-auto flex flex-wrap justify-end gap-2 pt-2">
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
