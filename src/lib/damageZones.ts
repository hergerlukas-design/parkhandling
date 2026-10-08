// Zonen der Schadensgrafik (übernommen aus dem ADE Fleet Manager, CarDamageSelector).
// Schlüssel sind die deutschen Positionsnamen aus DAMAGE_POSITIONS.

export type DamageView = 'top' | 'front' | 'back' | 'left' | 'right'

export const INTERIOR = 'Innenraum'

export const DAMAGE_VIEWS: { id: DamageView; label: string }[] = [
  { id: 'top', label: 'Oben' },
  { id: 'front', label: 'Vorne' },
  { id: 'back', label: 'Hinten' },
  { id: 'left', label: 'Links' },
  { id: 'right', label: 'Rechts' },
]

export const ZONE_TO_VIEW: Record<string, DamageView> = {
  'Motorhaube': 'top', 'Dach': 'top', 'Spiegel links': 'top', 'Spiegel rechts': 'top',
  'Frontscheibe': 'front', 'Scheinwerfer links': 'front', 'Scheinwerfer rechts': 'front',
  'Stoßfänger vorne': 'front', 'Kennzeichen vorne': 'front',
  'Heckscheibe': 'back', 'Rückleuchte links': 'back', 'Rückleuchte rechts': 'back',
  'Stoßfänger hinten': 'back', 'Kennzeichen hinten': 'back',
  'Kotflügel vorne links': 'left', 'Tür vorne links': 'left', 'Tür hinten links': 'left',
  'Kotflügel hinten links': 'left', 'Seitenscheibe vorne links': 'left',
  'Seitenscheibe hinten links': 'left', 'Reifen vorne links': 'left',
  'Felge vorne links': 'left', 'Reifen hinten links': 'left', 'Felge hinten links': 'left',
  'Kotflügel vorne rechts': 'right', 'Tür vorne rechts': 'right', 'Tür hinten rechts': 'right',
  'Kotflügel hinten rechts': 'right', 'Seitenscheibe vorne rechts': 'right',
  'Seitenscheibe hinten rechts': 'right', 'Reifen vorne rechts': 'right',
  'Felge vorne rechts': 'right', 'Reifen hinten rechts': 'right', 'Felge hinten rechts': 'right',
}

/** Ansicht, in der eine Position liegt (Innenraum hat keine eigene Ansicht) */
export function viewOf(pos: string): DamageView | null {
  return ZONE_TO_VIEW[pos] ?? null
}

/** Ansichten, die mindestens eine der Positionen enthalten (Punkt am Reiter) */
export function viewsWith(positions: Iterable<string>): Set<DamageView> {
  const out = new Set<DamageView>()
  for (const p of positions) {
    const v = viewOf(p)
    if (v) out.add(v)
  }
  return out
}
