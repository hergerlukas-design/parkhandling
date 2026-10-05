import { useEffect, useId } from 'react'
import { createStore, useStore } from '../store'

/**
 * Laufende Vorgänge (Protokoll, Unterschrift, Check-in), während derer kein Update
 * eingespielt werden darf. Schlüssel = Komponenten-ID, Wert = Anzeigename.
 */
const blockers = createStore<ReadonlyMap<string, string>>(new Map())

export function registerUpdateBlocker(id: string, label: string): () => void {
  blockers.set((prev) => new Map(prev).set(id, label))
  return () =>
    blockers.set((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
}

export function isUpdateBlocked(): boolean {
  return blockers.get().size > 0
}

export function subscribeBlockers(listener: () => void): () => void {
  return blockers.subscribe(listener)
}

/** Liste der Vorgänge, die das Update aktuell zurückhalten. */
export function useUpdateBlockers(): string[] {
  return [...useStore(blockers).values()]
}

/**
 * Hält App-Updates zurück, solange `active` true ist.
 * Beispiel: `useUpdateBlocker(isDirty, 'Annahmeprotokoll')`
 */
export function useUpdateBlocker(active: boolean, label: string): void {
  const id = useId()
  useEffect(() => {
    if (!active) return
    return registerUpdateBlocker(id, label)
  }, [active, id, label])
}
