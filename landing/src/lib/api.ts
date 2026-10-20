// Eigener Supabase-Client der Landingpage: nur der Functions-Client (kleines Bundle), kein Login,
// keine Sitzung im Browser-Speicher. Geschrieben wird ausschließlich über die Edge Function booking-checkout.
import { FunctionsClient, FunctionsHttpError } from '@supabase/functions-js'
import type { BookingForm } from './booking'

const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const functions = new FunctionsClient(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1`, {
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
})

export interface Tariff {
  code: string
  label: string
  parking_type: 'indoor' | 'outdoor_cover' | 'outdoor'
  shuttle_text: string
  included_text: string
  price_week: number
  price_holiday: number
  price_month: number
}

export type FieldErrors = Partial<Record<string, string>>

type Result<T> = { ok: true; data: T } | { ok: false; message: string; fields?: FieldErrors }

async function call<T>(body: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await functions.invoke<T>('booking-checkout', { body })
  if (!error) return { ok: true, data: data as T }
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response
    const parsed = (await res.json().catch(() => null)) as { error?: string; fields?: FieldErrors } | null
    if (res.status === 429)
      return { ok: false, message: 'Zu viele Versuche in kurzer Zeit. Bitte versuchen Sie es später erneut.' }
    return {
      ok: false,
      message: parsed?.error ?? 'Die Buchung konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
      fields: parsed?.fields,
    }
  }
  return { ok: false, message: 'Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung.' }
}

export async function fetchTariffs(): Promise<Tariff[]> {
  const res = await call<{ tariffs: Tariff[] }>({ action: 'tariffs' })
  if (!res.ok) throw new Error(res.message)
  return res.data.tariffs
}

export interface CheckoutStarted {
  checkout_id: string
  paypal_order_id: string
  amount: number
}

export function createCheckout(form: BookingForm) {
  return call<CheckoutStarted>({ action: 'create', form })
}

export interface WithdrawalForm {
  booking_ref: string
  email: string
  name: string
  reason: string
  consent_withdraw: boolean
  /** Honeypot – bleibt bei Menschen leer */
  website: string
}

export interface WithdrawalReceipt {
  booking_ref: string
  received_at: string
  duplicate?: boolean
}

/** Online-Widerruf: Eingang wird gespeichert und per E-Mail bestätigt */
export function submitWithdrawal(form: WithdrawalForm) {
  return call<WithdrawalReceipt>({ action: 'withdraw', form })
}

export function captureCheckout(checkoutId: string, paypalOrderId: string) {
  return call<{ booking_ref: string }>({ action: 'capture', checkout_id: checkoutId, paypal_order_id: paypalOrderId })
}
