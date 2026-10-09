// Eigener Supabase-Client der Landingpage: nur der Functions-Client (kleines Bundle), kein Login,
// keine Sitzung im Browser-Speicher. Geschrieben wird ausschließlich über die Edge Function inquiry-submit.
import { FunctionsClient, FunctionsHttpError } from '@supabase/functions-js'
import type { InquiryErrors, InquiryForm } from './inquiry'
import type { Attribution } from './utm'

const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const functions = new FunctionsClient(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1`, {
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
})

export interface InquiryPayload extends Omit<InquiryForm, 'parking_type'> {
  parking_type: string
  /** Honeypot – bleibt bei Menschen leer */
  website: string
  /** Wie lange das Formular offen war (Spam-Schutz, serverseitig geprüft) */
  form_duration_ms: number
  utm: Attribution['utm']
  referrer: string | null
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; message: string; fields?: InquiryErrors }

export async function submitInquiry(payload: InquiryPayload): Promise<SubmitResult> {
  const { error } = await functions.invoke('inquiry-submit', { body: payload })
  if (!error) return { ok: true }
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response
    const body = (await res.json().catch(() => null)) as { error?: string; fields?: InquiryErrors } | null
    if (res.status === 429)
      return { ok: false, message: 'Zu viele Anfragen in kurzer Zeit. Bitte versuchen Sie es in einer Stunde erneut.' }
    return {
      ok: false,
      message: body?.error ?? 'Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.',
      fields: body?.fields,
    }
  }
  return { ok: false, message: 'Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.' }
}
