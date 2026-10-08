import { del, get, set } from 'idb-keyval'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Icon } from '../components/Icon'
import { MediaThumb, PendingThumb } from '../components/media/MediaThumb'
import { PhotoCapture } from '../components/media/PhotoCapture'
import { DamageCard } from '../components/protocols/DamageCard'
import { SignaturePad } from '../components/protocols/SignaturePad'
import { Button, Dialog, ErrorList, Field, TextInput } from '../components/ui'
import { useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/format'
import { addPdf, addSignature, fullRef, uploadQueue, useMediaUrl, useObjectUrl, useUploadQueue, type MediaOwner } from '../lib/media/mediaService'
import { getMediaStore } from '../lib/media'
import type { QueueItem } from '../lib/media/uploadQueue'
import { sharePdfBlob } from '../lib/pdf/downloadPdf'
import { createProtocolPdf, protocolFilename } from '../lib/protocolPdf'
import {
  compareWithIntake,
  damageSlot,
  type DamageEntry,
  EXTRA_SLOT,
  FUEL_SEGMENTS,
  finalizeProtocol,
  formFromRow,
  getMedia,
  getOrCreateDraft,
  getProtocol,
  getProtocolBooking,
  INSPECTION_CONDITIONS,
  listProtocolMedia,
  newDamageId,
  normalizeDamage,
  PDF_SLOT,
  pendingSlotItems,
  PHOTO_SLOTS,
  PROTOCOL_TITLE,
  saveDraft,
  saveErrorMessage,
  sendProtocolMail,
  showsFuel,
  SIGNATURE_CUSTOMER,
  SIGNATURE_STAFF,
  validateForFinalize,
  type ProtocolBooking,
  type ProtocolForm,
  type ProtocolRow,
  type SlotMedia,
} from '../lib/protocols'
import { getCheckinCandidate, moveVehicle, recommendedSuggestion, suggestLocations, type Suggestion } from '../lib/siteplan'
import { useUpdateBlocker } from '../lib/update/updateGuard'
import type { ProtocolType } from '../types/domain'

const MAIL_STATUS: Record<string, string> = {
  sent: 'E-Mail an die Testadresse versendet',
  not_configured: 'E-Mail nicht versendet: Mail-Dienst noch nicht eingerichtet',
  disabled: 'E-Mail-Versand für Protokolle ist ausgeschaltet',
  failed: 'E-Mail-Versand fehlgeschlagen',
}

interface LocalDraft {
  form: ProtocolForm
  savedAt: string
}

const draftKey = (bookingId: string, type: ProtocolType) => `protocol-draft:${bookingId}:${type}`

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Unterschrift vollständig (nicht beschnitten) anzeigen */
function SignatureImage({ media, pending }: { media?: SlotMedia; pending?: QueueItem }) {
  const local = useObjectUrl(pending?.full ?? null)
  const { url: remote } = useMediaUrl(!pending && media ? fullRef(media) : null)
  const url = local ?? remote
  return (
    <div className="relative flex h-20 w-44 items-center justify-center rounded-lg border border-line bg-white">
      {url && <img src={url} alt="Unterschrift" className="max-h-full max-w-full object-contain" />}
      {pending && (
        <span className={`absolute inset-x-0 bottom-0 rounded-b-lg py-0.5 text-center text-[10px] font-semibold text-white ${pending.status === 'failed' ? 'bg-danger' : 'bg-ink/70'}`}>
          {pending.status === 'failed' ? 'Upload-Fehler' : 'wartet auf Upload'}
        </span>
      )}
    </div>
  )
}

/** Neuestes Medium bzw. wartendes Foto eines Slots */
function SlotPreview({ media, pending }: { media?: SlotMedia; pending?: QueueItem }) {
  if (pending) return <PendingThumb item={pending} />
  if (media) return <MediaThumb media={media} />
  return null
}

/** Tankstand als Slider mit 8 Segmenten (0 = leer, 8 = voll) */
function FuelSlider({ value, disabled, onChange }: { value: number | null; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2 text-sm font-medium text-subtle">
      <div className="flex items-baseline justify-between">
        <span>Tankstand</span>
        <span className="font-mono text-base text-ink">{value == null ? 'nicht erfasst' : `${value}/${FUEL_SEGMENTS}`}</span>
      </div>
      <div className="grid grid-cols-8 gap-1" aria-hidden="true">
        {Array.from({ length: FUEL_SEGMENTS }, (_, i) => (
          <span key={i} className={`h-3 rounded-sm ${value != null && i < value ? 'bg-accent' : 'bg-chip'}`} />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={FUEL_SEGMENTS}
        step={1}
        value={value ?? 0}
        disabled={disabled}
        aria-label="Tankstand in Segmenten"
        aria-valuetext={value == null ? 'nicht erfasst' : `${value} von ${FUEL_SEGMENTS}`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="touch-target h-11 w-full accent-accent"
      />
      <div className="flex justify-between text-xs text-muted">
        <span>leer</span>
        <span>voll</span>
      </div>
    </div>
  )
}

export function ProtocolPage() {
  const { type: typeParam, bookingId } = useParams()
  const type: ProtocolType = typeParam === 'uebergabe' ? 'handover' : 'intake'
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [booking, setBooking] = useState<ProtocolBooking | null>(null)
  const [row, setRow] = useState<ProtocolRow | null>(null)
  const [intake, setIntake] = useState<ProtocolRow | null>(null)
  const [form, setForm] = useState<ProtocolForm | null>(null)
  const [media, setMedia] = useState<SlotMedia[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [signing, setSigning] = useState<typeof SIGNATURE_STAFF | typeof SIGNATURE_CUSTOMER | null>(null)
  const [pdf, setPdf] = useState<{ blob: Blob; filename: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'local' | 'saving' | null>(null)
  // Grund, warum die Datenbank den Entwurf nicht bestätigt hat (sichtbar, nicht nur in der Statuszeile)
  const [saveError, setSaveError] = useState<string | null>(null)
  const dirty = useRef(false)

  // Neue Schadenseinträge, die noch nicht gespeichert sind (erscheinen erst nach „Speichern“ im Formular)
  const [draftDamages, setDraftDamages] = useState<DamageEntry[]>([])
  // Schadenskarten mit ungespeicherten Änderungen
  const [dirtyDamages, setDirtyDamages] = useState<Record<string, boolean>>({})

  const isFinal = row?.status === 'final'
  const queue = useUploadQueue()
  const pendingAll = useMemo(
    () => queue.items.filter((i) => i.ownerId != null && i.ownerId === row?.id && (i.ownerType === 'protocol' || i.ownerType === 'damage')),
    [queue.items, row?.id],
  )
  const pending = useMemo(() => pendingAll.filter((p) => p.kind !== 'pdf'), [pendingAll])
  const pdfPending = pendingAll.some((p) => p.kind === 'pdf')

  useUpdateBlocker(!!row && !isFinal, PROTOCOL_TITLE[type])

  // Nach der Annahme direkt den passenden Stellplatz vorschlagen
  const [recommendation, setRecommendation] = useState<Suggestion | null>(null)
  const recommendFor = type === 'intake' && isFinal && booking && (booking.status === 'booked' || booking.status === 'arrived')
    ? booking.id
    : null
  useEffect(() => {
    setRecommendation(null)
    if (!recommendFor) return
    let cancelled = false
    getCheckinCandidate(recommendFor)
      .then((c) => (c ? suggestLocations(c) : []))
      .then((list) => !cancelled && setRecommendation(recommendedSuggestion(list)))
      .catch(() => undefined) // Vorschlag ist optional; das Einchecken zeigt ihn erneut
    return () => {
      cancelled = true
    }
  }, [recommendFor])

  // Laden: Buchung, ggf. Annahme, Protokoll (Entwurf anlegen), lokalen Entwurf wiederherstellen
  const load = useCallback(async () => {
    if (!bookingId || !profile) return
    try {
      const b = await getProtocolBooking(bookingId)
      const base = type === 'handover' ? await getProtocol(bookingId, 'intake') : null
      const existing = await getProtocol(bookingId, type)
      const ctx = { type, booking: b, inspectorName: profile.display_name, intake: base }
      let current = existing
      if (!current) current = await getOrCreateDraft(bookingId, type, formFromRow(null, ctx))
      let initial = formFromRow(current, ctx)
      if (current.status === 'draft') {
        const local = await get<LocalDraft>(draftKey(bookingId, type)).catch(() => undefined)
        // Lokale Entwürfe älterer Versionen: Schäden mit Art/Intensität in Freitext überführen
        if (local && local.savedAt > current.updated_at) initial = { ...local.form, damages: (local.form.damages ?? []).map(normalizeDamage) }
      }
      setBooking(b)
      setIntake(base)
      setRow(current)
      setForm(initial)
      setMedia((await listProtocolMedia(current.id)) as SlotMedia[])
    } catch (e) {
      setErrors([(e as Error).message])
    }
  }, [bookingId, type, profile])

  useEffect(() => void load(), [load])

  // Fotoliste nach abgeschlossenen Uploads aktualisieren; PDF-Verknüpfung nachladen
  useEffect(() => {
    if (!row) return
    const unsubscribe = uploadQueue.onUploaded((e) => {
      if (e.ownerId !== row.id) return
      void listProtocolMedia(row.id).then((m) => setMedia(m as SlotMedia[]))
      if (e.slot === PDF_SLOT) setTimeout(() => void getProtocol(row.booking_id, row.type).then((r) => r && setRow(r)), 2500)
    })
    return () => void unsubscribe()
  }, [row])

  // Automatisch sichern: sofort lokal (IndexedDB), nach kurzer Pause in der Datenbank
  useEffect(() => {
    if (!form || !row || isFinal || !dirty.current) return
    const key = draftKey(row.booking_id, row.type)
    void set(key, { form, savedAt: new Date().toISOString() } satisfies LocalDraft).catch(() => undefined)
    setSaveState('local')
    const t = setTimeout(() => {
      if (!navigator.onLine) return
      setSaveState('saving')
      saveDraft(row.id, form)
        .then(() => {
          setSaveError(null)
          setSaveState('saved')
        })
        .catch((e) => {
          setSaveError(saveErrorMessage(e))
          setSaveState('local')
        })
    }, 1200)
    return () => clearTimeout(t)
  }, [form, row, isFinal])

  function update(patch: Partial<ProtocolForm>) {
    dirty.current = true
    setForm((f) => (f ? { ...f, ...patch } : f))
  }

  // Schadensfotos (Slot schaden_<id>) mit owner_type „damage“ und höherer Auflösung, übrige Fotos als „protocol“
  const owner = (slot: string): MediaOwner => ({
    bookingId: row?.booking_id ?? null,
    ownerType: slot.startsWith('schaden_') ? 'damage' : 'protocol',
    ownerId: row?.id ?? null,
    slot,
  })

  const latest = useMemo(() => {
    const bySlot = new Map<string, SlotMedia>()
    for (const m of media) if (m.slot && m.kind !== 'pdf') bySlot.set(m.slot, m)
    return bySlot
  }, [media])
  const latestPending = useMemo(() => {
    const bySlot = new Map<string, QueueItem>()
    for (const p of pending) if (p.slot) bySlot.set(p.slot, p)
    return bySlot
  }, [pending])
  const hasSlot = (slot: string) => latest.has(slot) || latestPending.has(slot)

  const comparison = useMemo(
    () => (type === 'handover' && form ? compareWithIntake(intake, form) : null),
    [type, intake, form],
  )

  if (!booking || !row || !form) {
    return (
      <div className="p-6">
        {errors.length ? <ErrorList errors={errors} /> : <p className="text-sm text-muted">Lädt …</p>}
      </div>
    )
  }

  const fuel = booking.fuel_type
  const title = PROTOCOL_TITLE[type]

  async function makePdf(status: 'draft' | 'final', f: ProtocolForm, protocol: ProtocolRow) {
    return createProtocolPdf({
      type,
      status,
      form: f,
      booking: booking!,
      media: (await listProtocolMedia(protocol.id)) as SlotMedia[],
      pending: pendingSlotItems(uploadQueue.getItems().filter((i) => i.ownerId === protocol.id)),
      inspectionDate: protocol.finalized_at ?? new Date().toISOString(),
      comparison,
    })
  }

  async function finalize() {
    if (!form || !row) return
    const problems = validateForFinalize(form, fuel, {
      staff: hasSlot(SIGNATURE_STAFF),
      customer: hasSlot(SIGNATURE_CUSTOMER),
    })
    if (unsavedDamages > 0) problems.unshift('Schäden noch nicht gespeichert: jeweils „Speichern“ drücken')
    setErrors(problems)
    if (problems.length) return
    setBusy('Protokoll wird abgeschlossen …')
    try {
      const final = await finalizeProtocol(row.id, form)
      setRow(final)
      await del(draftKey(row.booking_id, row.type)).catch(() => undefined)
      setBusy('PDF wird erstellt …')
      const file = await makePdf('final', form, final)
      setPdf(file)
      await addPdf(file.blob, owner(PDF_SLOT))
      setNotice(navigator.onLine ? 'Protokoll abgeschlossen. PDF wird gespeichert und versendet.' : 'Protokoll abgeschlossen. PDF wird hochgeladen, sobald wieder Netz da ist.')
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setBusy(null)
    }
  }

  async function sharePdf() {
    if (!row || !form) return
    setBusy('PDF wird geladen …')
    setErrors([])
    try {
      let file = pdf
      if (!file && row.pdf_media_id) {
        const m = await getMedia(row.pdf_media_id)
        const url = await getMediaStore(m.provider).getViewUrl(fullRef(m), { expiresIn: 300 })
        const res = await fetch(url)
        if (!res.ok) throw new Error('PDF konnte nicht geladen werden')
        file = { blob: await res.blob(), filename: protocolFilename(type, booking!.plate, row.finalized_at ?? row.updated_at) }
      }
      if (!file) file = await makePdf(isFinal ? 'final' : 'draft', form, row)
      await sharePdfBlob(file.blob, file.filename)
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setBusy(null)
    }
  }

  async function resendMail() {
    if (!row) return
    setBusy('E-Mail wird versendet …')
    const status = await sendProtocolMail(row.id)
    const fresh = await getProtocol(row.booking_id, row.type)
    if (fresh) setRow(fresh)
    setNotice(status ? MAIL_STATUS[status] ?? status : null)
    setBusy(null)
  }

  async function handOver() {
    if (!row) return
    setBusy('Fahrzeug wird übergeben …')
    try {
      await moveVehicle(row.booking_id, null, 'Übergabe an Kunde')
      navigate(`/fahrzeuge/${row.booking_id}`)
    } catch (e) {
      setErrors([(e as Error).message])
      setBusy(null)
    }
  }

  async function onSignature(png: Blob) {
    if (!signing) return
    const slot = signing
    setSigning(null)
    try {
      await addSignature(png, owner(slot))
    } catch (e) {
      setErrors([(e as Error).message])
    }
  }

  const fieldsDisabled = isFinal || !!busy
  const unsavedDamages = draftDamages.length + Object.values(dirtyDamages).filter(Boolean).length
  const canCheckIn = booking.status === 'booked' || booking.status === 'arrived'
  const handedOver = booking.status === 'completed'
  const extraMedia = media.filter((m) => m.slot === EXTRA_SLOT)
  const extraPending = pending.filter((p) => p.slot === EXTRA_SLOT)

  return (
    <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to={`/fahrzeuge/${booking.id}`} className="touch-target flex items-center justify-center rounded-lg hover:bg-chip" aria-label="Zurück">
            <Icon name="back" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {title} <span className="font-mono">{booking.plate}</span>
            </h1>
            <p className="text-sm text-subtle">
              {[booking.vehicle_model, booking.customer_name, isFinal && row.finalized_at ? `abgeschlossen ${formatDateTime(row.finalized_at)}` : 'Entwurf'].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {!isFinal && saveState === 'saving' && 'Speichert …'}
          {!isFinal && saveState === 'saved' && 'Entwurf gespeichert'}
          {!isFinal && saveState === 'local' && 'Nur auf dem Gerät gesichert (nicht in der Datenbank)'}
          <Button onClick={() => void sharePdf()} disabled={!!busy}>
            {isFinal ? 'PDF teilen / herunterladen' : 'PDF-Vorschau'}
          </Button>
        </div>
      </header>

      {notice && <p className="rounded-xl bg-ok-soft px-4 py-2 text-sm text-ok-ink" role="status">{notice}</p>}
      {saveError && !isFinal && (
        <p className="rounded-xl bg-danger-soft px-4 py-2 text-sm text-danger-ink" role="alert">{saveError}</p>
      )}
      <ErrorList errors={errors} />

      {isFinal && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
          <div className="text-sm">
            <p className="font-semibold">{title} abgeschlossen – nicht mehr änderbar.</p>
            <p className="text-subtle">
              {pdfPending
                ? 'PDF wartet auf den Upload …'
                : row.pdf_media_id
                  ? row.mail_status
                    ? `${MAIL_STATUS[row.mail_status]}${row.mail_error ? `: ${row.mail_error}` : ''}`
                    : 'PDF gespeichert, E-Mail wird vorbereitet …'
                  : 'PDF wird gespeichert …'}
            </p>
            {type === 'intake' && canCheckIn && recommendation && (
              <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-accent-dark">
                <span className="font-semibold">Empfohlener Stellplatz {recommendation.code}</span> – {recommendation.reason}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {row.pdf_media_id && row.mail_status !== 'sent' && (
              <Button onClick={() => void resendMail()} disabled={!!busy}>E-Mail erneut senden</Button>
            )}
            {type === 'intake' && canCheckIn && (
              <Button variant="primary" onClick={() => navigate(`/einchecken?booking=${booking.id}${recommendation ? `&platz=${encodeURIComponent(recommendation.code)}` : ''}`)}>
                {recommendation ? `Einchecken auf ${recommendation.code}` : 'Weiter zum Einchecken'}
              </Button>
            )}
            {type === 'handover' && !handedOver && (
              <Button variant="primary" onClick={() => void handOver()} disabled={!!busy}>Fahrzeug übergeben</Button>
            )}
            {(type === 'intake' ? !canCheckIn : handedOver) && (
              <Button variant="primary" onClick={() => navigate(`/fahrzeuge/${booking.id}`)}>Zum Fahrzeug</Button>
            )}
          </div>
        </div>
      )}

      {comparison && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${comparison.newDamages.length ? 'border-danger/40 bg-danger-soft text-danger-ink' : 'border-line bg-white'}`}>
          <p className="mb-1 font-semibold">Vergleich zur Annahme</p>
          <ul className="list-disc pl-5">
            {comparison.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset disabled={fieldsDisabled} className="grid min-w-0 gap-4 lg:grid-cols-3">
        {/* Spalte 1: Basisdaten und Zustand */}
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Basisdaten">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Field label="Mitarbeiter">
                <TextInput value={form.inspector_name} onChange={(e) => update({ inspector_name: e.target.value })} />
              </Field>
              <Field label="FIN (optional)">
                <TextInput value={form.vin} maxLength={17} className="font-mono uppercase" onChange={(e) => update({ vin: e.target.value })} />
              </Field>
              <Field label={type === 'intake' ? 'Ort' : 'Von → Nach'} className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
                <TextInput value={form.location_text} onChange={(e) => update({ location_text: e.target.value })} />
              </Field>
            </div>
          </Section>

          <Section title="Zustand">
            <Field label="Kilometerstand (Dezimalkomma möglich)">
              <TextInput inputMode="decimal" value={form.mileage} placeholder="z. B. 84213,5" onChange={(e) => update({ mileage: e.target.value })} />
            </Field>
            {showsFuel(fuel) && (
              <FuelSlider value={form.fuel_level} disabled={fieldsDisabled} onChange={(v) => update({ fuel_level: v })} />
            )}
            {!fuel && <p className="text-xs text-muted">Antriebsart unbekannt – Tankstand erfassen, bei E-Fahrzeugen in der Buchung „Elektro“ setzen.</p>}
            <div className="flex flex-col gap-1 text-sm font-medium text-subtle">
              Bedingungen bei der Prüfung
              <div className="flex flex-wrap gap-1.5">
                {INSPECTION_CONDITIONS.map((c) => {
                  const on = form.conditions.includes(c)
                  return (
                    <button key={c} type="button" aria-pressed={on}
                      onClick={() => update({ conditions: on ? form.conditions.filter((x) => x !== c) : [...form.conditions, c] })}
                      className={`touch-target rounded-full border px-3 text-sm ${on ? 'border-warn bg-warn-soft text-warn-ink' : 'border-line-strong bg-surface text-subtle'}`}>
                      {c}
                    </button>
                  )
                })}
              </div>
            </div>
          </Section>

        </div>

        {/* Spalte 2: Fotos und Schäden */}
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Fotos">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
              {PHOTO_SLOTS.map(({ slot, label }) => (
                <div key={slot} className={`flex flex-col gap-2 rounded-xl border p-2 ${hasSlot(slot) ? 'border-ok/50 bg-ok-soft' : 'border-dashed border-line-strong'}`}>
                  <span className="text-sm font-semibold">{label}{hasSlot(slot) ? ' ✓' : ''}</span>
                  <SlotPreview media={latest.get(slot)} pending={latestPending.get(slot)} />
                  {!isFinal && <PhotoCapture owner={owner(slot)} label={hasSlot(slot) ? 'Neu' : 'Foto'} single />}
                  {isFinal && !hasSlot(slot) && <span className="text-xs text-muted">kein Foto</span>}
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Schäden"
            aside={!isFinal && (
              <Button onClick={() => setDraftDamages((list) => [...list, { id: newDamageId(), pos: '', desc: '' }])}>
                + Schaden
              </Button>
            )}
          >
            {form.damages.length + draftDamages.length === 0 && <p className="text-sm text-muted">Keine Schäden erfasst.</p>}
            {[...form.damages.map((d) => ({ d, saved: true })), ...draftDamages.map((d) => ({ d, saved: false }))].map(({ d, saved }, i) => {
              const markers = [...form.damages, ...draftDamages].filter((x) => x.id !== d.id && x.pos).map((x) => x.pos)
              const isNew = !!comparison?.newDamages.some((n) => n.id === d.id)
              const photoSlot = damageSlot(d.id)
              return (
                <DamageCard
                  key={d.id}
                  damage={d}
                  index={i}
                  isNew={isNew}
                  markers={markers}
                  readOnly={fieldsDisabled}
                  onDirtyChange={(dirty) => setDirtyDamages((m) => (m[d.id] === dirty ? m : { ...m, [d.id]: dirty }))}
                  onSave={(entry) => {
                    if (saved) update({ damages: form.damages.map((x) => (x.id === entry.id ? entry : x)) })
                    else {
                      update({ damages: [...form.damages, entry] })
                      setDraftDamages((list) => list.filter((x) => x.id !== entry.id))
                    }
                  }}
                  onRemove={() => {
                    if (saved) update({ damages: form.damages.filter((x) => x.id !== d.id) })
                    setDraftDamages((list) => list.filter((x) => x.id !== d.id))
                  }}
                  photo={
                    <>
                      <SlotPreview media={latest.get(photoSlot)} pending={latestPending.get(photoSlot)} />
                      {!isFinal && <PhotoCapture owner={owner(photoSlot)} label={hasSlot(photoSlot) ? 'Foto ersetzen' : 'Foto'} single />}
                    </>
                  }
                />
              )
            })}
          </Section>

          <Section title="Weitere Fotos" aside={!isFinal && <PhotoCapture owner={owner(EXTRA_SLOT)} label="Hinzufügen" />}>
            {extraMedia.length + extraPending.length === 0 ? (
              <p className="text-sm text-muted">Optional, z. B. Innenraum oder Tacho.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {extraMedia.map((m) => <MediaThumb key={m.id} media={m} />)}
                {extraPending.map((p) => <PendingThumb key={p.id} item={p} />)}
              </div>
            )}
          </Section>
        </div>

        {/* Spalte 3: Bestätigung */}
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Bestätigung">
            <Field label="Bemerkung">
              <textarea rows={3} value={form.remarks} onChange={(e) => update({ remarks: e.target.value })}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base md:text-sm" />
            </Field>
            <Field label="Name Kunde">
              <TextInput value={form.customer_signer_name} onChange={(e) => update({ customer_signer_name: e.target.value })} />
            </Field>
            {([
              [SIGNATURE_CUSTOMER, 'Unterschrift Kunde'],
              [SIGNATURE_STAFF, 'Unterschrift Mitarbeiter'],
            ] as const).map(([slot, label]) => (
              <div key={slot} className="flex flex-col gap-2">
                <span className="text-sm font-medium text-subtle">{label}</span>
                <div className="flex items-center gap-3">
                  {hasSlot(slot) ? (
                    <SignatureImage media={latest.get(slot)} pending={latestPending.get(slot)} />
                  ) : (
                    <span className="text-sm text-muted">fehlt</span>
                  )}
                  {!isFinal && (
                    <Button onClick={() => setSigning(slot)}>{hasSlot(slot) ? 'Neu unterschreiben' : 'Unterschreiben'}</Button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted">
              {type === 'intake'
                ? 'Kunde bestätigt den dokumentierten Zustand und die gebuchten Leistungen.'
                : 'Kunde bestätigt die Rückgabe des Fahrzeugs im dokumentierten Zustand.'}
            </p>
            {!isFinal && (
              <>
                <Button variant="primary" className="w-full" onClick={() => void finalize()} disabled={!!busy}>
                  Abschließen &amp; PDF senden
                </Button>
                <p className="text-xs text-muted">
                  PDF im Layout Vehicle Protocol Pro V2. Im Prototyp nur an die Testadresse, nicht an {booking.customer_email ?? 'den Kunden'}.
                </p>
              </>
            )}
          </Section>
        </div>
      </fieldset>

      {busy && <p className="fixed inset-x-0 bottom-24 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg md:bottom-6" role="status">{busy}</p>}

      {signing && (
        <Dialog title={signing === SIGNATURE_CUSTOMER ? 'Unterschrift Kunde' : 'Unterschrift Mitarbeiter'} onClose={() => setSigning(null)}>
          <SignaturePad
            label={signing === SIGNATURE_CUSTOMER ? `${form.customer_signer_name || 'Kunde'} unterschreibt hier` : `${form.inspector_name} unterschreibt hier`}
            onCancel={() => setSigning(null)}
            onConfirm={(png) => void onSignature(png)}
          />
        </Dialog>
      )}
    </div>
  )
}
