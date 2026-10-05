import { createStore as createIdbStore, del, get, keys, set } from 'idb-keyval'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Formularentwürfe in IndexedDB. Sie überleben ein Neuladen (App-Update, Absturz,
 * Akku leer) und werden beim nächsten Öffnen des Formulars wiederhergestellt.
 */
const draftStore = createIdbStore('pf-drafts', 'drafts')

interface DraftRecord<T> {
  value: T
  savedAt: string
  appVersion: string
}

const pendingWrites = new Map<string, () => Promise<void>>()

export async function saveDraft<T>(key: string, value: T): Promise<void> {
  const record: DraftRecord<T> = {
    value,
    savedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
  }
  await set(key, record, draftStore)
}

export async function loadDraft<T>(key: string): Promise<DraftRecord<T> | undefined> {
  return get<DraftRecord<T>>(key, draftStore)
}

export async function clearDraft(key: string): Promise<void> {
  pendingWrites.delete(key)
  await del(key, draftStore)
}

export async function listDraftKeys(): Promise<string[]> {
  return (await keys(draftStore)).map(String)
}

/** Schreibt alle noch nicht gespeicherten (entprellten) Entwürfe sofort weg. */
export async function flushDrafts(): Promise<void> {
  const writes = [...pendingWrites.values()]
  pendingWrites.clear()
  await Promise.all(writes.map((write) => write()))
}

/**
 * useState mit automatischer Sicherung in IndexedDB.
 * `restored` ist true, wenn ein vorhandener Entwurf geladen wurde.
 * `discard()` nach erfolgreichem Abschluss aufrufen.
 */
export function useDraft<T>(key: string, initial: T, debounceMs = 400) {
  const [value, setValue] = useState<T>(initial)
  const [ready, setReady] = useState(false)
  const [restored, setRestored] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    loadDraft<T>(key)
      .then((draft) => {
        if (cancelled) return
        if (draft) {
          setValue(draft.value)
          setRestored(true)
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setReady(true))
    return () => {
      cancelled = true
    }
  }, [key])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        const write = () => saveDraft(key, resolved)
        pendingWrites.set(key, write)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          if (pendingWrites.get(key) === write) pendingWrites.delete(key)
          void write()
        }, debounceMs)
        return resolved
      })
    },
    [key, debounceMs],
  )

  const discard = useCallback(async () => {
    clearTimeout(timer.current)
    await clearDraft(key)
    setRestored(false)
  }, [key])

  return { value, setValue: update, ready, restored, discard }
}
