import type { Service } from '../types/domain'
import { parseMoney } from '../booking-adapters/parse'
import { supabase } from './supabase'

/**
 * Leistungskatalog (Tabelle `services`) pflegen: Einstellungen → Leistungen.
 * Lesen darf das ganze Personal, ändern nur Admins (RLS admin_insert / admin_update).
 * Änderungen gelten für neu gebuchte Leistungen; bestehende Aufgaben behalten ihre Checkliste.
 */

export const SERVICE_CATEGORY_LABEL: Record<string, string> = {
  cleaning: 'Reinigung / Pflege',
  service: 'Service',
  charge: 'Laden',
  fuel: 'Tanken',
  other: 'Sonstiges',
}

/** Formularwerte einer Leistung (Preis als Text mit Dezimalkomma) */
export interface ServiceForm {
  id: string | null
  code: string
  name: string
  description: string
  category: string
  price: string
  steps: string[]
  active: boolean
  is_default: boolean
  sort_order: string
}

export interface ServiceRow {
  code: string
  name: string
  description: string | null
  category: string
  price: number | null
  steps: string[]
  active: boolean
  is_default: boolean
  sort_order: number
}

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export function emptyServiceForm(sortOrder = 100): ServiceForm {
  return {
    id: null,
    code: '',
    name: '',
    description: '',
    category: 'service',
    price: '',
    steps: [],
    active: true,
    is_default: false,
    sort_order: String(sortOrder),
  }
}

export function serviceToForm(s: Service): ServiceForm {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    description: s.description ?? '',
    category: s.category,
    price: s.price === null || s.price === undefined ? '' : Number(s.price).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    steps: Array.isArray(s.steps) ? [...s.steps] : [],
    active: s.active,
    is_default: s.is_default,
    sort_order: String(s.sort_order),
  }
}

/** Code wie im Katalog: Großbuchstaben, Ziffern und Unterstrich („Reinigung außen“ → „REINIGUNG_AUSSEN“) */
export function normalizeServiceCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Formular prüfen und in eine Tabellenzeile umwandeln. Leere Checklisten-Schritte fallen weg. */
export function validateServiceForm(
  form: ServiceForm,
  existingCodes: string[] = [],
): { ok: true; row: ServiceRow } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const code = normalizeServiceCode(form.code)
  const name = form.name.trim()
  if (!name) errors.push('Name fehlt')
  if (!code) errors.push('Code fehlt')
  else if (code.length > 30) errors.push('Code höchstens 30 Zeichen')
  else if (!form.id && existingCodes.includes(code)) errors.push(`Code ${code} gibt es schon`)
  if (!SERVICE_CATEGORY_LABEL[form.category]) errors.push('Kategorie ungültig')
  const price = parseMoney(form.price)
  if (form.price.trim() && price === null) errors.push('Preis ungültig')
  const sortOrder = Number(form.sort_order)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) errors.push('Reihenfolge: ganze Zahl 0 bis 9999')
  const steps = form.steps.map((s) => s.trim()).filter(Boolean)
  if (steps.some((s) => s.length > 200)) errors.push('Checklisten-Schritt höchstens 200 Zeichen')
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    row: {
      code,
      name,
      description: form.description.trim() || null,
      category: form.category,
      price,
      steps,
      active: form.active,
      is_default: form.is_default,
      sort_order: sortOrder,
    },
  }
}

/** Alle Leistungen, auch inaktive, in Katalog-Reihenfolge */
export async function listAllServices(): Promise<Service[]> {
  const { data, error } = await db().from('services').select('*').order('sort_order').order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as Service[]
}

/** Anlegen oder ändern. Der Code einer bestehenden Leistung bleibt (Tarife und Importe verweisen darauf). */
export async function saveService(id: string | null, row: ServiceRow): Promise<Service> {
  const q = id
    ? db()
        .from('services')
        .update({ ...row, code: undefined, updated_at: new Date().toISOString() })
        .eq('id', id)
    : db().from('services').insert(row)
  const { data, error } = await q.select('*').single()
  if (error) {
    if (error.code === '42501' || /row-level security/i.test(error.message)) throw new Error('Nur Admins dürfen Leistungen ändern.')
    if (error.code === '23505') throw new Error(`Code ${row.code} gibt es schon.`)
    throw new Error(error.message)
  }
  return data as Service
}

/** Tarife, die eine Leistung enthalten bzw. ausschließen (zur Anzeige) */
export async function tariffUsage(): Promise<{ included: Record<string, string[]>; excluded: Record<string, string[]> }> {
  const { data } = await db().from('booking_tariffs').select('label, included_services, excluded_services').eq('active', true).order('sort_order')
  const included: Record<string, string[]> = {}
  const excluded: Record<string, string[]> = {}
  for (const t of (data ?? []) as { label: string; included_services: { code: string }[] | null; excluded_services: string[] | null }[]) {
    for (const x of t.included_services ?? []) (included[x.code.toUpperCase()] ??= []).push(t.label)
    for (const c of t.excluded_services ?? []) (excluded[c.toUpperCase()] ??= []).push(t.label)
  }
  return { included, excluded }
}
