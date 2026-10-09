// UTM-Parameter: beim Laden aus der URL lesen, für die Sitzung in sessionStorage halten
// (technisch notwendig, kein Cookie, keine Drittanbieter) und beim Absenden mitsenden.

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type UtmKey = (typeof UTM_KEYS)[number]
export type Utm = Partial<Record<UtmKey, string>>

export interface Attribution {
  utm: Utm
  referrer: string | null
}

const STORAGE_KEY = 'pf_landing_attribution'
const MAX_LENGTH = 200

type SessionStore = Pick<Storage, 'getItem' | 'setItem'>

function safeStorage(): SessionStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function readAttribution(storage: SessionStore | null = safeStorage()): Attribution {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as Attribution | null
    if (parsed && typeof parsed === 'object' && parsed.utm) return parsed
  } catch {
    // beschädigter Eintrag → wie leer behandeln
  }
  return { utm: {}, referrer: null }
}

/**
 * Übernimmt UTM-Parameter aus der URL. Neue UTM-Werte ersetzen die gespeicherten vollständig
 * (letzte Anzeige zählt). Der Referrer wird nur beim ersten Aufruf der Sitzung gemerkt und
 * nur, wenn er von einer fremden Seite kommt.
 */
export function captureAttribution(
  search: string,
  referrer: string,
  ownOrigin: string,
  storage: SessionStore | null = safeStorage(),
): Attribution {
  const current = readAttribution(storage)
  const params = new URLSearchParams(search)
  const utm: Utm = {}
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim()
    if (value) utm[key] = value.slice(0, MAX_LENGTH)
  }
  let external: string | null = null
  try {
    external = referrer && new URL(referrer).origin !== ownOrigin ? referrer.slice(0, 500) : null
  } catch {
    external = null
  }
  const next: Attribution = {
    utm: Object.keys(utm).length > 0 ? utm : current.utm,
    referrer: current.referrer ?? external,
  }
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Speicher gesperrt (z. B. privater Modus) → nur für diesen Aufruf
  }
  return next
}
