/**
 * Kennzeichen vereinheitlichen – gemeinsam für alle Portal-Adapter.
 *
 * Deutsche Kennzeichen bestehen aus Unterscheidungszeichen (1–3 Buchstaben),
 * Erkennungsbuchstaben (1–2) und Zahl (1–4 Ziffern, optional E/H).
 * Drei erkennbare Blöcke („M MM 3839“, „m-mm3839“) werden zu „M-MM 3839“.
 * Alles andere (z. B. „MMM3839“, ausländische Kennzeichen) bleibt wie eingegeben
 * und gilt als ungeprüft. Die Suche läuft ohnehin formatunabhängig über `plate_normalized`.
 */
export function normalizePlate(raw: string): { plate: string; verified: boolean } {
  const t = raw
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /^([A-ZÄÖÜ]{1,3})\s*[-\s]\s*([A-Z]{1,2})\s*[-\s]?\s*(\d{1,4}[EH]?)$/.exec(t)
  if (m) return { plate: `${m[1]}-${m[2]} ${m[3]}`, verified: true }
  return { plate: t, verified: false }
}
