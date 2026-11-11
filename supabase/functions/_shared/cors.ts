// Für die internen Funktionen der App (mit Anmeldung): unverändert offen
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// -----------------------------------------------------------------------------
// Öffentliche Buchungsfunktion (booking-checkout): nur freigegebene Herkünfte.
// Liste im Secret BOOKING_ALLOWED_ORIGINS (durch Komma oder Leerraum getrennt).
// -----------------------------------------------------------------------------

/** Gilt, solange das Secret BOOKING_ALLOWED_ORIGINS nicht gesetzt ist */
export const DEFAULT_BOOKING_ORIGINS = [
  'https://parkhandling-rechner.pplx.app',
  'https://parkhandling.fly.dev',
  'https://www.parkhandling.de',
  // Landingpage im Repo (landing/, Fly-App parkhandling-landing) – nutzt create/capture/withdraw/resend
  'https://parkhandling-landing.fly.dev',
]

export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  const list = (raw ?? '')
    .split(/[\s,]+/)
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_BOOKING_ORIGINS
}

export function originAllowed(origin: string | null, allowed: string[]): boolean {
  return origin !== null && allowed.includes(origin.replace(/\/+$/, ''))
}

/** CORS-Header für eine Anfrage: Allow-Origin nur für freigegebene Herkünfte, nie „*“ */
export function bookingCorsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': corsHeaders['Access-Control-Allow-Headers'],
    'Access-Control-Allow-Methods': corsHeaders['Access-Control-Allow-Methods'],
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (originAllowed(origin, allowed)) headers['Access-Control-Allow-Origin'] = origin as string
  return headers
}

/** Antwort mit den CORS-Headern der Buchungsfunktion versehen (ersetzt ein vorhandenes „*“) */
export function withBookingCors(res: Response, origin: string | null, allowed: string[]): Response {
  const headers = new Headers(res.headers)
  headers.delete('Access-Control-Allow-Origin')
  for (const [k, v] of Object.entries(bookingCorsHeaders(origin, allowed))) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}
