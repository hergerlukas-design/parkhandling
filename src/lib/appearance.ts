import { createStore } from './store'

/**
 * Darstellung der App, je Gerät gespeichert.
 * - `standard`: helles Layout aus dem Klick-Prototyp (mockup/)
 * - `website`: Alternativ-Modus im Look von parkhandling.de und dem Rechner
 *   (dunkelgrau, Montserrat/Mulish, eckig, Rot als Akzent, Buttons mit Reifenprofil)
 */
export type Appearance = 'standard' | 'website'

export const APPEARANCE_OPTIONS: { id: Appearance; label: string; text: string }[] = [
  { id: 'standard', label: 'Standard', text: 'Hell, wie bisher' },
  { id: 'website', label: 'Website-Design', text: 'Dunkel, wie parkhandling.de und der Rechner' },
]

const STORAGE_KEY = 'pf-appearance'

/** Farbe der Browser-/Statusleiste je Darstellung */
const THEME_COLOR: Record<Appearance, string> = { standard: '#1a1d21', website: '#2b2b2d' }

export function parseAppearance(value: string | null | undefined): Appearance {
  return value === 'website' ? 'website' : 'standard'
}

function readStored(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'standard'
  }
}

export const appearanceStore = createStore<Appearance>(typeof window === 'undefined' ? 'standard' : readStored())

/** Setzt das Attribut am <html>-Element; alle Farben hängen daran (index.css) */
export function applyAppearance(value: Appearance = appearanceStore.get()) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (value === 'website') root.dataset.look = 'website'
  else delete root.dataset.look
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[value])
}

export function setAppearance(value: Appearance) {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Speicher gesperrt (privater Modus): gilt nur bis zum Neuladen
  }
  appearanceStore.set(value)
  applyAppearance(value)
}
