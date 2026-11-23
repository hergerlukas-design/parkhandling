import type { ParkingType, ReturnMode } from '../types/domain'
import { supabase } from './supabase'

/**
 * Tarife wie auf der Website (Preisrechner parkhandling-rechner): Economy, Economy +, Business,
 * Premium. Quelle ist die Tabelle `booking_tariffs`; die Preislogik entspricht dem Rechner.
 */
export interface Tariff {
  code: string
  label: string
  parking_type: ParkingType
  /** Grundpreis für bis zu 5 Tage */
  base_price: number
  /** Preis je weiterem Tag */
  extra_day_price: number
  /** Im Tarif enthaltene Leistungen [{code, description}] */
  included_services: { code: string; description?: string | null }[]
  /** Standardleistungen, die der Tarif nicht enthält (z. B. GRUND bei Economy) */
  excluded_services: string[]
  sort_order: number
}

/** Bezeichnung der Stellplatzart wie auf der Website */
export const TARIFF_TYPE_LABEL: Record<ParkingType, string> = {
  outdoor: 'Outdoor',
  outdoor_cover: 'Outdoor mit Car-Cover',
  indoor: 'Indoor',
}

/** Grundpreis deckt so viele Tage ab */
export const INCLUDED_DAYS = 5
/** Hol-/Bring-Service: Pauschale in jedem Tarif */
export const VALET_FEE = 24.5
/** Selbst bringen/abholen: Nachlass auf den Parkpreis in Prozent */
export const SELF_DISCOUNT_PERCENT = 10
/** E-Auto laden: Ladepauschale, Strom wird bei Rückgabe abgerechnet */
export const CHARGING_FEE = 10
export const CHARGING_KWH_PRICE = 0.69
export const CHARGING_TARGETS = ['80 %', '100 %'] as const

export async function listTariffs(): Promise<Tariff[]> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  const { data, error } = await supabase
    .from('booking_tariffs')
    .select('code, label, parking_type, base_price, extra_day_price, included_services, excluded_services, sort_order')
    .eq('active', true)
    .order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []).map((t) => ({
    ...t,
    base_price: Number(t.base_price),
    extra_day_price: Number(t.extra_day_price),
    included_services: Array.isArray(t.included_services) ? t.included_services : [],
    excluded_services: t.excluded_services ?? [],
  })) as Tariff[]
}

/** „Economy + · Outdoor mit Car-Cover“ */
export function tariffOptionLabel(t: Pick<Tariff, 'label' | 'parking_type'>): string {
  return `${t.label} · ${TARIFF_TYPE_LABEL[t.parking_type]}`
}

/** Tage wie im Rechner: Anreise- und Abreisetag zählen jeweils voll (Uhrzeiten zählen nicht) */
export function websiteDays(startDate: string, endDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1
  return days >= 1 ? days : null
}

export interface WebsitePrice {
  days: number
  extraDays: number
  park: number
  valet: number
  discount: number
  charging: number
  total: number
}

const cents = (n: number) => Math.round(n * 100) / 100

/**
 * Preis wie im Website-Rechner: Grundpreis (bis 5 Tage) + weitere Tage × Tagespreis,
 * Hol-/Bring-Service +24,50 €, Selbst bringen/abholen −10 % auf den Parkpreis,
 * E-Auto laden +10,00 € Pauschale. Unter 5 Tagen gilt der Grundpreis.
 */
export function websitePrice(
  tariff: Pick<Tariff, 'base_price' | 'extra_day_price'>,
  args: { startDate: string; endDate: string; returnMode: ReturnMode; charging: boolean },
): WebsitePrice | null {
  const days = websiteDays(args.startDate, args.endDate)
  if (days === null) return null
  const extraDays = Math.max(0, days - INCLUDED_DAYS)
  const park = cents(tariff.base_price + extraDays * tariff.extra_day_price)
  const valet = args.returnMode === 'pickup_delivery' ? VALET_FEE : 0
  const discount = args.returnMode === 'self' ? Math.round(park * SELF_DISCOUNT_PERCENT) / 100 : 0
  const charging = args.charging ? CHARGING_FEE : 0
  return { days, extraDays, park, valet, discount, charging, total: cents(park + valet - discount + charging) }
}

/** Beschreibung der Leistung „Laden“ wie bei Online-Buchungen */
export function chargingDescription(target: string): string {
  return `Ladeziel: ${target} · Ladepauschale ${CHARGING_FEE.toFixed(2).replace('.', ',')} € im Preis, Strom ${CHARGING_KWH_PRICE.toFixed(2).replace('.', ',')} €/kWh bei Rückgabe`
}

/** Ladeziel aus der Beschreibung lesen (Standard 80 %) */
export function chargingTargetFrom(description: string | null | undefined): string {
  const m = /Ladeziel:\s*(\d{1,3})\s*%/.exec(description ?? '')
  return m ? `${m[1]} %` : CHARGING_TARGETS[0]
}
