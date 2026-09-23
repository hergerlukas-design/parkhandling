import { createStore as createIdbStore, del, entries, set } from 'idb-keyval'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Media, MediaOwnerType } from '../../types/domain'
import { getDeviceId } from '../deviceId'
import { supabase } from '../supabase'
import { getMediaStore } from './index'
import { processPhoto, processSignature } from './imagePipeline'
import type { MediaRef, UploadTarget } from './types'
import { createUploadQueue, UploadHttpError, type QueueItem } from './uploadQueue'

const idb = createIdbStore('pf-uploads', 'queue')

async function putBlob(target: UploadTarget, blob: Blob): Promise<void> {
  const res = await fetch(target.url, { method: target.method, headers: target.headers, body: blob })
  if (res.ok) return
  const text = await res.text().catch(() => '')
  // Bereits vorhanden = ein früherer Versuch war erfolgreich, nur die Bestätigung fehlte
  if (res.status === 409 || /already exists|Duplicate/i.test(text)) return
  throw new UploadHttpError(res.status, `Upload fehlgeschlagen (HTTP ${res.status})`)
}

export const uploadQueue = createUploadQueue({
  persistence: {
    getAll: async () => (await entries<string, QueueItem>(idb)).map(([, v]) => v),
    put: (item) => set(item.id, item, idb),
    delete: (id) => del(id, idb),
  },
  store: () => getMediaStore(),
  upload: putBlob,
  async confirm(ticket, item) {
    if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
    const { error } = await supabase
      .from('media')
      .update({
        uploaded_at: new Date().toISOString(),
        bytes: item.full.size,
        thumb_bytes: item.thumb?.size ?? 0,
      })
      .eq('id', ticket.mediaId)
    if (error) throw error
  },
  deviceId: getDeviceId,
  isOnline: () => navigator.onLine,
})

let started = false

/** Einmalig beim App-Start: Queue laden und bei Netz/fälligen Einträgen abarbeiten. */
export function startMediaUploads(): void {
  if (started || !supabase) return
  started = true
  void uploadQueue.process()
  window.addEventListener('online', () => void uploadQueue.process())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void uploadQueue.process()
  })
  setInterval(() => {
    if (uploadQueue.nextDueAt() <= Date.now()) void uploadQueue.process()
  }, 15_000)
}

export interface MediaOwner {
  bookingId: string | null
  ownerType: MediaOwnerType
  ownerId: string | null
}

/** Fotos komprimieren (Worker) und zum Upload einreihen. Originale verlassen das Gerät nie. */
export async function addPhotos(files: Iterable<File>, owner: MediaOwner): Promise<QueueItem[]> {
  const queued: QueueItem[] = []
  for (const file of files) {
    const { full, thumb } = await processPhoto(file)
    queued.push(
      await uploadQueue.enqueue({
        ...owner,
        kind: 'photo',
        full: full.blob,
        width: full.width,
        height: full.height,
        thumb: thumb?.blob ?? null,
        takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      }),
    )
  }
  return queued
}

export async function addSignature(png: Blob, owner: MediaOwner): Promise<QueueItem> {
  const { full } = await processSignature(png)
  return uploadQueue.enqueue({
    ...owner,
    kind: 'signature',
    full: full.blob,
    width: full.width,
    height: full.height,
    thumb: null,
    takenAt: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// React-Hooks
// ---------------------------------------------------------------------------

export function useUploadQueue() {
  const items = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getItems, uploadQueue.getItems)
  return useMemo(
    () => ({
      items,
      pending: items.filter((i) => i.status === 'pending').length,
      uploading: items.filter((i) => i.status === 'uploading').length,
      failed: items.filter((i) => i.status === 'failed').length,
    }),
    [items],
  )
}

/** Noch nicht hochgeladene Dateien eines Besitzers (für lokale Vorschau). */
export function usePendingMedia(ownerType: MediaOwnerType, ownerId: string | null) {
  const { items } = useUploadQueue()
  return useMemo(
    () => items.filter((i) => i.ownerType === ownerType && i.ownerId === ownerId),
    [items, ownerType, ownerId],
  )
}

export function thumbRef(media: Pick<Media, 'provider' | 'bucket' | 'path' | 'thumb_path'>): MediaRef {
  return { provider: media.provider, bucket: media.bucket, path: media.thumb_path ?? media.path }
}

export function fullRef(media: Pick<Media, 'provider' | 'bucket' | 'path'>): MediaRef {
  return { provider: media.provider, bucket: media.bucket, path: media.path }
}

/** Signierte Anzeige-URL (gecacht und gebündelt). */
export function useMediaUrl(ref: MediaRef | null): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ key: string; url: string | null; error: string | null }>({
    key: '',
    url: null,
    error: null,
  })
  const key = ref ? `${ref.provider}:${ref.bucket}/${ref.path}` : ''
  useEffect(() => {
    if (!ref) return
    let cancelled = false
    getMediaStore(ref.provider)
      .getViewUrl(ref)
      .then((url) => !cancelled && setState({ key, url, error: null }))
      .catch((err: Error) => !cancelled && setState({ key, url: null, error: err.message }))
    return () => {
      cancelled = true
    }
  }, [key])
  return state.key === key ? { url: state.url, error: state.error } : { url: null, error: null }
}

/** Objekt-URL für einen lokalen Blob mit automatischer Freigabe. */
export function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  return url
}
