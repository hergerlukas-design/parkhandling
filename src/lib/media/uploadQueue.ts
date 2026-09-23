import type { MediaKind, MediaOwnerType } from '../../types/domain'
import type { MediaStore, UploadTarget, UploadTicket } from './types'

/**
 * Offline-Upload-Queue (Abschnitt 11.2): Bereits komprimierte Dateien werden in
 * IndexedDB abgelegt und im Hintergrund hochgeladen, sobald Netz da ist.
 */

export type QueueStatus = 'pending' | 'uploading' | 'failed'

export interface QueueInput {
  bookingId: string | null
  ownerType: MediaOwnerType
  ownerId: string | null
  kind: MediaKind
  full: Blob
  width: number | null
  height: number | null
  thumb: Blob | null
  takenAt: string | null
}

export interface QueueItem extends QueueInput {
  id: string
  status: QueueStatus
  attempts: number
  nextAttemptAt: number
  lastError: string | null
  /** Bereits ausgestelltes Upload-Ticket; verhindert doppelte media-Zeilen bei Wiederholung. */
  ticket: UploadTicket | null
  createdAt: string
}

export interface UploadedEvent {
  localId: string
  mediaId: string
  bookingId: string | null
  ownerType: MediaOwnerType
  ownerId: string | null
  kind: MediaKind
}

export interface QueuePersistence {
  getAll(): Promise<QueueItem[]>
  put(item: QueueItem): Promise<void>
  delete(id: string): Promise<void>
}

export interface QueueDeps {
  persistence: QueuePersistence
  store: () => MediaStore
  /** Lädt einen Blob an ein Upload-Ziel hoch (HTTP PUT). */
  upload: (target: UploadTarget, blob: Blob) => Promise<void>
  /** Bestätigt den Upload in der Datenbank (media.uploaded_at). */
  confirm: (ticket: UploadTicket, item: QueueItem) => Promise<void>
  deviceId: () => string
  isOnline: () => boolean
  now?: () => number
  newId?: () => string
}

export class UploadHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const MAX_BACKOFF_MS = 10 * 60 * 1000

export function backoffMs(attempts: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

/** 4xx außer 408/429 sind dauerhafte Fehler: nicht automatisch wiederholen. */
export function isPermanentError(err: unknown): boolean {
  const status =
    err instanceof UploadHttpError
      ? err.status
      : typeof (err as { context?: { status?: unknown } })?.context?.status === 'number'
        ? ((err as { context: { status: number } }).context.status)
        : undefined
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
}

export function createUploadQueue(deps: QueueDeps) {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? (() => crypto.randomUUID())
  let items: QueueItem[] = []
  let loaded: Promise<void> | null = null
  let running: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const uploadedListeners = new Set<(e: UploadedEvent) => void>()

  const emit = () => listeners.forEach((l) => l())

  function load() {
    loaded ??= deps.persistence.getAll().then((stored) => {
      // Nach Absturz/Neuladen hängende Uploads zurücksetzen
      items = stored
        .map((i) => (i.status === 'uploading' ? { ...i, status: 'pending' as const } : i))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      emit()
    })
    return loaded
  }

  async function save(item: QueueItem) {
    items = items.some((i) => i.id === item.id)
      ? items.map((i) => (i.id === item.id ? item : i))
      : [...items, item]
    emit()
    await deps.persistence.put(item)
  }

  async function drop(id: string) {
    items = items.filter((i) => i.id !== id)
    emit()
    await deps.persistence.delete(id)
  }

  async function uploadOne(item: QueueItem) {
    let current: QueueItem = { ...item, status: 'uploading' }
    await save(current)
    try {
      let ticket = current.ticket
      if (!ticket || Date.parse(ticket.expiresAt) <= now()) {
        ticket = await deps.store().getUploadUrl({
          bookingId: current.bookingId,
          ownerType: current.ownerType,
          ownerId: current.ownerId,
          kind: current.kind,
          contentType: current.full.type,
          bytes: current.full.size,
          thumbContentType: current.thumb?.type ?? null,
          thumbBytes: current.thumb?.size ?? null,
          width: current.width,
          height: current.height,
          takenAt: current.takenAt,
          deviceId: deps.deviceId(),
        })
        current = { ...current, ticket }
        await save(current)
      }
      await deps.upload(ticket.file, current.full)
      if (ticket.thumb && current.thumb) await deps.upload(ticket.thumb, current.thumb)
      await deps.confirm(ticket, current)
      await drop(current.id)
      const event: UploadedEvent = {
        localId: current.id,
        mediaId: ticket.mediaId,
        bookingId: current.bookingId,
        ownerType: current.ownerType,
        ownerId: current.ownerId,
        kind: current.kind,
      }
      uploadedListeners.forEach((l) => l(event))
    } catch (err) {
      const attempts = current.attempts + 1
      const permanent = isPermanentError(err)
      await save({
        ...current,
        status: permanent ? 'failed' : 'pending',
        attempts,
        nextAttemptAt: permanent ? Number.POSITIVE_INFINITY : now() + backoffMs(attempts),
        lastError: (err as Error)?.message ?? String(err),
      })
    }
  }

  async function processNow() {
    await load()
    while (deps.isOnline()) {
      const next = items.find((i) => i.status === 'pending' && i.nextAttemptAt <= now())
      if (!next) break
      await uploadOne(next)
    }
  }

  return {
    /** Legt eine bereits komprimierte Datei in die Queue und startet den Upload. */
    async enqueue(input: QueueInput): Promise<QueueItem> {
      await load()
      const item: QueueItem = {
        ...input,
        id: newId(),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        ticket: null,
        createdAt: new Date(now()).toISOString(),
      }
      await save(item)
      void this.process()
      return item
    },

    /** Arbeitet fällige Einträge nacheinander ab (nie parallel zu einem laufenden Durchgang). */
    process(): Promise<void> {
      running ??= processNow().finally(() => {
        running = null
      })
      return running
    },

    /** Fehlgeschlagenen oder wartenden Eintrag sofort erneut versuchen. */
    async retry(id: string) {
      await load()
      const item = items.find((i) => i.id === id)
      if (!item || item.status === 'uploading') return
      await save({ ...item, status: 'pending', nextAttemptAt: 0 })
      await this.process()
    },

    async remove(id: string) {
      await load()
      await drop(id)
    },

    load,
    getItems: () => items,
    /** Frühester Zeitpunkt, zu dem ein wartender Eintrag wieder fällig ist. */
    nextDueAt: () =>
      items.filter((i) => i.status === 'pending').reduce((min, i) => Math.min(min, i.nextAttemptAt), Infinity),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onUploaded(listener: (e: UploadedEvent) => void) {
      uploadedListeners.add(listener)
      return () => uploadedListeners.delete(listener)
    },
  }
}

export type UploadQueue = ReturnType<typeof createUploadQueue>
