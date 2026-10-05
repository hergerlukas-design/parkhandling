const KEY = 'pf-device-id'
let cached: string | null = null

/** Stabile, zufällige Geräte-ID (für Rate-Limits und Nachvollziehbarkeit, keine Hardware-ID). */
export function getDeviceId(): string {
  if (cached) return cached
  try {
    cached = localStorage.getItem(KEY)
    if (!cached) {
      cached = crypto.randomUUID()
      localStorage.setItem(KEY, cached)
    }
  } catch {
    cached ??= crypto.randomUUID()
  }
  return cached
}
