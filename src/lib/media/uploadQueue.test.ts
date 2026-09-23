import { describe, expect, it, vi } from 'vitest'
import type { MediaStore, UploadTicket } from './types'
import { backoffMs, createUploadQueue, UploadHttpError, type QueueItem } from './uploadQueue'

function memoryPersistence(initial: QueueItem[] = []) {
  const map = new Map(initial.map((i) => [i.id, i]))
  return {
    map,
    getAll: async () => [...map.values()],
    put: async (item: QueueItem) => void map.set(item.id, item),
    delete: async (id: string) => void map.delete(id),
  }
}

const ticket = (id: string, expiresAt = '2999-01-01T00:00:00Z'): UploadTicket => ({
  mediaId: id,
  provider: 'supabase',
  bucket: 'media',
  path: `x/${id}.webp`,
  thumbPath: `x/${id}_thumb.webp`,
  file: { url: `https://up/${id}`, method: 'PUT', headers: {} },
  thumb: { url: `https://up/${id}_thumb`, method: 'PUT', headers: {} },
  expiresAt,
})

function setup(opts: { online?: () => boolean; upload?: () => Promise<void>; persistence?: ReturnType<typeof memoryPersistence> } = {}) {
  let n = 0
  const store: MediaStore = {
    provider: 'supabase',
    getUploadUrl: vi.fn(async () => ticket(`m${++n}`)),
    getViewUrl: vi.fn(),
    delete: vi.fn(),
    archive: vi.fn(),
  }
  const persistence = opts.persistence ?? memoryPersistence()
  const upload = vi.fn(opts.upload ?? (async () => undefined))
  const confirm = vi.fn(async () => undefined)
  let t = 1_000_000
  const queue = createUploadQueue({
    persistence,
    store: () => store,
    upload,
    confirm,
    deviceId: () => 'dev-1',
    isOnline: opts.online ?? (() => true),
    now: () => t,
    newId: () => `local-${++n}`,
  })
  return { queue, store, upload, confirm, persistence, advance: (ms: number) => (t += ms) }
}

const input = () => ({
  bookingId: 'b1',
  ownerType: 'task' as const,
  ownerId: 't1',
  kind: 'photo' as const,
  full: new Blob(['x'.repeat(100)], { type: 'image/webp' }),
  thumb: new Blob(['y'.repeat(10)], { type: 'image/webp' }),
  width: 1600,
  height: 1200,
  takenAt: null,
})

describe('uploadQueue', () => {
  it('lädt Vollbild und Thumbnail hoch, bestätigt und entfernt den Eintrag', async () => {
    const { queue, upload, confirm, persistence } = setup()
    const onUploaded = vi.fn()
    queue.onUploaded(onUploaded)
    await queue.enqueue(input())
    await queue.process()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(persistence.map.size).toBe(0)
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 't1', kind: 'photo' }))
  })

  it('wartet offline und lädt später hoch', async () => {
    let online = false
    const { queue, upload, persistence } = setup({ online: () => online })
    await queue.enqueue(input())
    await queue.process()
    expect(upload).not.toHaveBeenCalled()
    expect(persistence.map.size).toBe(1)
    online = true
    await queue.process()
    expect(persistence.map.size).toBe(0)
  })

  it('wiederholt nach Netzfehler mit Backoff und nutzt dasselbe Ticket', async () => {
    let fail = true
    const { queue, store, advance, persistence } = setup({
      upload: async () => {
        if (fail) throw new TypeError('Failed to fetch')
      },
    })
    await queue.enqueue(input())
    await queue.process()
    const [item] = [...persistence.map.values()]
    expect(item.status).toBe('pending')
    expect(item.attempts).toBe(1)
    expect(item.ticket?.mediaId).toBe('m2')

    fail = false
    await queue.process() // noch nicht fällig
    expect(persistence.map.size).toBe(1)
    advance(backoffMs(1))
    await queue.process()
    expect(persistence.map.size).toBe(0)
    expect(store.getUploadUrl).toHaveBeenCalledTimes(1)
  })

  it('markiert dauerhafte Fehler (z. B. 413) als fehlgeschlagen ohne Auto-Retry', async () => {
    const { queue, persistence, advance, upload } = setup({
      upload: async () => {
        throw new UploadHttpError(413, 'zu groß')
      },
    })
    await queue.enqueue(input())
    await queue.process()
    advance(60 * 60 * 1000)
    await queue.process()
    const [item] = [...persistence.map.values()]
    expect(item.status).toBe('failed')
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('setzt nach Neustart hängende Uploads zurück', async () => {
    const stuck: QueueItem = {
      ...input(),
      id: 'old',
      status: 'uploading',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      ticket: null,
      createdAt: '2026-01-01T00:00:00Z',
    }
    const { queue, persistence } = setup({ persistence: memoryPersistence([stuck]) })
    await queue.process()
    expect(persistence.map.size).toBe(0)
  })
})

describe('backoffMs', () => {
  it('verdoppelt bis maximal 10 Minuten', () => {
    expect(backoffMs(1)).toBe(5000)
    expect(backoffMs(2)).toBe(10000)
    expect(backoffMs(20)).toBe(600000)
  })
})
