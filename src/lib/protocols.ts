import type { FuelType, Media, ProtocolType } from '../types/domain'
import { uploadQueue } from './media/mediaService'
import type { QueueItem } from './media/uploadQueue'
import type { PdfData, PdfLabels } from './pdf/generatePdf'
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

// ---------------------------------------------------------------------------
// Stammlisten (aus fahrzeug-protokolle-v2)
// ---------------------------------------------------------------------------

export const SITE_NAME = 'Park & Fly Flughafen München'

export const INSPECTION_CONDITIONS = ['Verschmutzung', 'Regen', 'Dunkelheit', 'Schlechtes Licht'] as const

/** Schadenspositionen (deutsche Schlüssel wie in der PDF-Vorlage) */
export const DAMAGE_POSITIONS = [
  'Motorhaube', 'Dach', 'Frontscheibe', 'Heckscheibe', 'Innenraum',
  'Spiegel links', 'Spiegel rechts',
  'Scheinwerfer links', 'Scheinwerfer rechts', 'Stoßfänger vorne', 'Kennzeichen vorne',
  'Stoßfänger hinten', 'Kennzeichen hinten', 'Rückleuchte links', 'Rückleuchte rechts',
  'Kotflügel vorne links', 'Kotflügel vorne rechts', 'Kotflügel hinten links', 'Kotflügel hinten rechts',
  'Tür vorne links', 'Tür vorne rechts', 'Tür hinten links', 'Tür hinten rechts',
  'Seitenscheibe vorne links', 'Seitenscheibe vorne rechts', 'Seitenscheibe hinten links', 'Seitenscheibe hinten rechts',
  'Reifen vorne links', 'Reifen vorne rechts', 'Reifen hinten links', 'Reifen hinten rechts',
  'Felge vorne links', 'Felge vorne rechts', 'Felge hinten links', 'Felge hinten rechts',
] as const

export const PHOTO_SLOTS = [
  { slot: 'vorne', label: 'Vorne' },
  { slot: 'hinten', label: 'Hinten' },
  { slot: 'links', label: 'Links' },
  { slot: 'rechts', label: 'Rechts' },
  { slot: 'schein', label: 'Fahrzeugschein' },
] as const

export const SIGNATURE_STAFF = 'signature'
export const SIGNATURE_CUSTOMER = 'signature_customer'
export const EXTRA_SLOT = 'zusatz'
export const PDF_SLOT = 'pdf'
export const damageSlot = (damageId: string) => `schaden_${damageId}`

export const PROTOCOL_TITLE: Record<ProtocolType, string> = {
  intake: 'Annahmeprotokoll',
  handover: 'Übergabeprotokoll',
}

// ---------------------------------------------------------------------------
// Datentypen
// ---------------------------------------------------------------------------

export interface DamageEntry {
  /** Stabile ID (Foto-Slot schaden_<id>), damit Löschen die Fotozuordnung nicht verschiebt */
  id: string
  /** Position aus der Schadensgrafik, z. B. "Tür vorne links" */
  pos: string
  /** Freitext, z. B. "Kratzer, ca. 10 cm, oberflächlich" */
  desc: string
}

/** Gespeicherter Schaden; vor 0.13.0 mit Art (type) und Intensität (int) statt Freitext */
export type StoredDamage = Partial<DamageEntry> & { type?: string; int?: string }

/** Ältere Einträge (Art + Intensität) in einen Freitext überführen */
export function normalizeDamage(d: StoredDamage): DamageEntry {
  return {
    id: d.id ?? newDamageId(),
    pos: d.pos ?? '',
    desc: d.desc ?? [d.type, d.int].filter(Boolean).join(', '),
  }
}

export interface ProtocolForm {
  inspector_name: string
  location_text: string
  vin: string
  mileage: string
  fuel_level: number | null
  soc_percent: number | null
  conditions: string[]
  damages: DamageEntry[]
  remarks: string
  customer_signer_name: string
}

export interface ProtocolRow {
  id: string
  booking_id: string
  type: ProtocolType
  status: 'draft' | 'final'
  inspector_name: string | null
  location_text: string | null
  vin: string | null
  mileage: number | null
  fuel_level: number | null
  soc_percent: number | null
  conditions: string[]
  damages: StoredDamage[]
  remarks: string | null
  customer_signer_name: string | null
  signature_media_id: string | null
  customer_signature_media_id: string | null
  pdf_media_id: string | null
  finalized_at: string | null
  sent_at: string | null
  mail_status: 'sent' | 'not_configured' | 'failed' | 'disabled' | null
  mail_error: string | null
  created_at: string
  updated_at: string
}

export interface ProtocolBooking {
  id: string
  plate: string
  vehicle_model: string | null
  fuel_type: FuelType | null
  customer_name: string
  customer_email: string | null
  status: string
  start_at: string
  end_at: string
}

export function newDamageId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export const showsFuel = (fuel: FuelType | null) => fuel !== 'electric'
export const showsBattery = (fuel: FuelType | null) => fuel === 'electric' || fuel === 'hybrid'

export function defaultLocation(type: ProtocolType, customerName: string): string {
  return type === 'intake' ? SITE_NAME : `${SITE_NAME} → ${customerName}`
}

/** Formular aus gespeichertem Protokoll bzw. Vorgaben (bei Übergabe aus der Annahme übernommen). */
export function formFromRow(
  row: ProtocolRow | null,
  ctx: { type: ProtocolType; booking: ProtocolBooking; inspectorName: string; intake?: ProtocolRow | null },
): ProtocolForm {
  const base = ctx.intake
  return {
    inspector_name: row?.inspector_name ?? ctx.inspectorName,
    location_text: row?.location_text ?? defaultLocation(ctx.type, ctx.booking.customer_name),
    vin: row?.vin ?? base?.vin ?? '',
    mileage: row?.mileage != null ? String(row.mileage) : '',
    fuel_level: row?.fuel_level ?? null,
    soc_percent: row?.soc_percent ?? null,
    conditions: row?.conditions ?? [],
    damages: (row?.damages ?? []).map(normalizeDamage),
    remarks: row?.remarks ?? '',
    customer_signer_name: row?.customer_signer_name ?? ctx.booking.customer_name,
  }
}

export function parseMileage(value: string): number | null {
  const digits = value.replace(/[.\s]/g, '')
  if (!/^\d{1,7}$/.test(digits)) return null
  return Number(digits)
}

/** Pflichtangaben vor dem Abschließen */
export function validateForFinalize(
  form: ProtocolForm,
  fuel: FuelType | null,
  signatures: { staff: boolean; customer: boolean },
): string[] {
  const errors: string[] = []
  if (!form.inspector_name.trim()) errors.push('Name des Mitarbeiters fehlt')
  if (parseMileage(form.mileage) == null) errors.push('Kilometerstand fehlt oder ist ungültig')
  if (showsFuel(fuel) && form.fuel_level == null) errors.push('Tankstand fehlt')
  if (showsBattery(fuel) && form.soc_percent == null) errors.push('Akkustand fehlt')
  for (const [i, d] of form.damages.entries()) {
    if (!d.pos || !d.desc.trim()) errors.push(`Schaden ${i + 1}: Position und Beschreibung angeben`)
  }
  if (!form.customer_signer_name.trim()) errors.push('Name des Kunden fehlt')
  if (!signatures.staff) errors.push('Unterschrift Mitarbeiter fehlt')
  if (!signatures.customer) errors.push('Unterschrift Kunde fehlt')
  return errors
}

// ---------------------------------------------------------------------------
// Vergleich Übergabe ↔ Annahme
// ---------------------------------------------------------------------------

export interface Comparison {
  mileageDiff: number | null
  fuelDiff: number | null
  socDiff: number | null
  newDamages: DamageEntry[]
  lines: string[]
}


export function compareWithIntake(
  intake: Pick<ProtocolRow, 'mileage' | 'fuel_level' | 'soc_percent' | 'damages'> | null,
  form: ProtocolForm,
): Comparison {
  const mileage = parseMileage(form.mileage)
  const mileageDiff = intake?.mileage != null && mileage != null ? mileage - intake.mileage : null
  const fuelDiff = intake?.fuel_level != null && form.fuel_level != null ? form.fuel_level - intake.fuel_level : null
  const socDiff = intake?.soc_percent != null && form.soc_percent != null ? form.soc_percent - intake.soc_percent : null
  // Freitext lässt sich nicht verlässlich vergleichen: neu ist ein Schaden an einer Position ohne Schaden bei der Annahme
  const known = new Set((intake?.damages ?? []).map((d) => d.pos))
  const newDamages = intake ? form.damages.filter((d) => d.pos && !known.has(d.pos)) : []
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n))
  const lines: string[] = []
  if (!intake) {
    lines.push('Kein Annahmeprotokoll vorhanden')
  } else {
    if (mileageDiff != null) lines.push(`KM seit Annahme: ${sign(mileageDiff)} km (Annahme ${intake.mileage} km)`)
    if (fuelDiff != null) lines.push(`Tank: ${sign(fuelDiff)} % (Annahme ${intake.fuel_level} %)`)
    if (socDiff != null) lines.push(`Akku: ${sign(socDiff)} % (Annahme ${intake.soc_percent} %)`)
    lines.push(
      newDamages.length
        ? `Neue Schaeden seit Annahme: ${newDamages.map((d) => (d.desc.trim() ? `${d.pos} (${d.desc.trim()})` : d.pos)).join(', ')}`
        : 'Keine neuen Schaeden seit Annahme',
    )
  }
  return { mileageDiff, fuelDiff, socDiff, newDamages, lines }
}

// ---------------------------------------------------------------------------
// PDF-Daten
// ---------------------------------------------------------------------------

/** Ohne Checkliste rücken die Abschnitte der Vorlage eins nach vorn */
const SECTION_LABELS: Partial<PdfLabels> = {
  section4: '3. Bemerkungen',
  section5: '4. Fotodokumentation',
  section6: '5. Erfasste Schaeden',
  section7: '6. Weitere Fotos',
}

/** Beschriftungen der Vorlage für Park & Fly (Helvetica: ohne Umlaute) */
export function pdfLabels(type: ProtocolType): Partial<PdfLabels> {
  return type === 'intake'
    ? { ...SECTION_LABELS, carrier_sig: 'Uebergabe durch Kunde', creator_sig_label: 'Annahme durch (Mitarbeiter)', creator: 'Mitarbeiter' }
    : {
        ...SECTION_LABELS,
        title_transfer: 'Fahrzeug-Uebergabeprotokoll',
        creator: 'Mitarbeiter',
        receiver: 'Kunde',
        sig_creator: 'Mitarbeiter',
        sig_receiver: 'Kunde',
        transfer_type_label: 'Art',
      }
}

/** Neuestes Medium je Slot; Zusatzfotos in Aufnahmereihenfolge */
export function pickSlotUrls(items: { slot: string | null; url: string; created_at: string }[]): Record<string, string> {
  const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const out: Record<string, string> = {}
  let extra = 0
  for (const m of sorted) {
    if (!m.slot || m.slot === PDF_SLOT) continue
    if (m.slot === EXTRA_SLOT) out[`zusatz_${extra++}`] = m.url
    else out[m.slot] = m.url
  }
  return out
}

export function buildPdfData(input: {
  type: ProtocolType
  status: 'draft' | 'final'
  form: ProtocolForm
  booking: ProtocolBooking
  /** URLs je Slot (vorne, schaden_<id>, zusatz_<n>, signature, signature_customer) */
  slotUrls: Record<string, string>
  inspectionDate: string
  comparison?: Comparison | null
}): PdfData {
  const { type, form, booking, slotUrls } = input
  const photos: Record<string, string> = {}
  for (const { slot } of PHOTO_SLOTS) if (slotUrls[slot]) photos[slot] = slotUrls[slot]
  for (const [k, v] of Object.entries(slotUrls)) if (k.startsWith('zusatz_')) photos[k] = v
  form.damages.forEach((d, i) => {
    const url = slotUrls[damageSlot(d.id)]
    if (url) photos[`schaden_${i}`] = url
  })
  if (slotUrls[SIGNATURE_STAFF]) photos.signature = slotUrls[SIGNATURE_STAFF]
  if (slotUrls[SIGNATURE_CUSTOMER]) {
    photos[type === 'intake' ? 'signature_carrier' : 'signature_receiver'] = slotUrls[SIGNATURE_CUSTOMER]
  }

  const remarks = [
    type === 'intake' && form.customer_signer_name ? `Fahrzeug uebergeben von: ${form.customer_signer_name}` : '',
    ...(input.comparison?.lines ?? []),
    form.remarks.trim(),
  ]
    .filter(Boolean)
    .join('\n')

  // Nicht erfasste Werte als „–“ statt 0 % (Vorlage interpoliert nur den Wert)
  const dash = '–' as unknown as number
  return {
    protocol_type: type === 'intake' ? 'annahme' : 'transfer',
    status: input.status,
    inspector_name: form.inspector_name,
    location: form.location_text,
    odometer: parseMileage(form.mileage) ?? 0,
    fuel_level: form.fuel_level ?? dash,
    battery: form.soc_percent ?? dash,
    remarks,
    inspection_date: input.inspectionDate,
    license_plate: booking.plate,
    brand_model: booking.vehicle_model ?? '',
    vin: form.vin,
    photos,
    conditions: form.conditions,
    damage_records: form.damages.map(({ pos, desc }) => ({ pos, desc: desc.trim() })),
    receiver_name: type === 'handover' ? form.customer_signer_name : undefined,
    transfer_type: type === 'handover' ? 'Rueckgabe an Kunde' : undefined,
  }
}

// ---------------------------------------------------------------------------
// Datenbank
// ---------------------------------------------------------------------------

const PROTOCOL_COLUMNS =
  'id, booking_id, type, status, inspector_name, location_text, vin, mileage, fuel_level, soc_percent, conditions, damages, remarks, customer_signer_name, signature_media_id, customer_signature_media_id, pdf_media_id, finalized_at, sent_at, mail_status, mail_error, created_at, updated_at'

export async function getProtocolBooking(bookingId: string): Promise<ProtocolBooking> {
  const { data, error } = await db()
    .from('bookings')
    .select('id, plate, vehicle_model, fuel_type, customer_name, customer_email, status, start_at, end_at')
    .eq('id', bookingId)
    .single()
  if (error) throw new Error(error.message)
  return data as ProtocolBooking
}

export async function listProtocols(bookingId: string): Promise<ProtocolRow[]> {
  const { data, error } = await db().from('protocols').select(PROTOCOL_COLUMNS).eq('booking_id', bookingId)
  if (error) throw new Error(error.message)
  return (data ?? []) as ProtocolRow[]
}

export async function getProtocol(bookingId: string, type: ProtocolType): Promise<ProtocolRow | null> {
  const { data, error } = await db()
    .from('protocols')
    .select(PROTOCOL_COLUMNS)
    .eq('booking_id', bookingId)
    .eq('type', type)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ProtocolRow | null) ?? null
}

/** Entwurf anlegen (idempotent über booking_id + type) */
export async function getOrCreateDraft(bookingId: string, type: ProtocolType, init: ProtocolForm): Promise<ProtocolRow> {
  const existing = await getProtocol(bookingId, type)
  if (existing) return existing
  const { data, error } = await db()
    .from('protocols')
    .insert({ booking_id: bookingId, type, status: 'draft', ...formToColumns(init) })
    .select(PROTOCOL_COLUMNS)
    .single()
  if (error) {
    // Parallel angelegt (anderes Gerät) → vorhandenen Entwurf verwenden
    if (error.code === '23505') {
      const again = await getProtocol(bookingId, type)
      if (again) return again
    }
    throw new Error(error.message)
  }
  return data as ProtocolRow
}

function formToColumns(form: ProtocolForm) {
  return {
    inspector_name: form.inspector_name.trim() || null,
    location_text: form.location_text.trim() || null,
    vin: form.vin.trim().toUpperCase() || null,
    mileage: parseMileage(form.mileage),
    fuel_level: form.fuel_level,
    soc_percent: form.soc_percent,
    conditions: form.conditions,
    damages: form.damages,
    remarks: form.remarks.trim() || null,
    customer_signer_name: form.customer_signer_name.trim() || null,
  }
}

export async function saveDraft(protocolId: string, form: ProtocolForm): Promise<void> {
  const { error } = await db().from('protocols').update(formToColumns(form)).eq('id', protocolId).eq('status', 'draft')
  if (error) throw new Error(error.message)
}

export async function finalizeProtocol(protocolId: string, form: ProtocolForm): Promise<ProtocolRow> {
  const { data, error } = await db()
    .from('protocols')
    .update({ ...formToColumns(form), status: 'final' })
    .eq('id', protocolId)
    .eq('status', 'draft')
    .select(PROTOCOL_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return data as ProtocolRow
}

export async function listProtocolMedia(protocolId: string): Promise<Media[]> {
  const { data, error } = await db()
    .from('media')
    .select('*')
    .eq('owner_type', 'protocol')
    .eq('owner_id', protocolId)
    .not('uploaded_at', 'is', null)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as Media[]
}

export async function getMedia(id: string): Promise<Media> {
  const { data, error } = await db().from('media').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as Media
}

/** Media-Zeile mit Slot (Spalte seit 0.8.1) */
export type SlotMedia = Media & { slot: string | null }

/** Lokale (noch nicht hochgeladene) Dateien eines Protokolls als Slot-Liste */
export function pendingSlotItems(items: QueueItem[]) {
  return items
    .filter((i) => i.kind !== 'pdf')
    .map((i) => ({ slot: i.slot ?? null, blob: i.full, created_at: i.createdAt }))
}

export async function sendProtocolMail(protocolId: string): Promise<string | null> {
  const { data, error } = await db().functions.invoke('protocol-mail', { body: { protocol_id: protocolId } })
  if (error) return error.message
  return (data as { status?: string } | null)?.status ?? null
}

// ---------------------------------------------------------------------------
// Upload-Nachlauf: Unterschriften und PDF am Protokoll vermerken, dann Mail
// ---------------------------------------------------------------------------

let syncStarted = false

/** Einmalig beim App-Start. Läuft auch, wenn der Upload erst nach einem Neustart klappt. */
export function startProtocolSync(): void {
  if (syncStarted || !supabase) return
  syncStarted = true
  uploadQueue.onUploaded((e) => {
    if (e.ownerType !== 'protocol' || !e.ownerId) return
    const column =
      e.slot === PDF_SLOT
        ? 'pdf_media_id'
        : e.slot === SIGNATURE_STAFF
          ? 'signature_media_id'
          : e.slot === SIGNATURE_CUSTOMER
            ? 'customer_signature_media_id'
            : null
    if (!column) return
    void (async () => {
      const { error } = await db().from('protocols').update({ [column]: e.mediaId }).eq('id', e.ownerId!)
      if (error) {
        console.warn('Protokoll-Verknüpfung fehlgeschlagen', error.message)
        return
      }
      if (column === 'pdf_media_id') await sendProtocolMail(e.ownerId!)
    })()
  })
}
