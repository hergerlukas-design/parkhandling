/**
 * Hält Signed URLs bis kurz vor Ablauf vor. Dadurch bleibt die URL eines Bildes
 * innerhalb einer Sitzung stabil und der Browser-Cache greift (weniger Egress).
 * Anfragen im selben Tick werden zu einem Batch zusammengefasst.
 */
export interface SignedUrlCacheOptions {
  /** Signiert mehrere Pfade eines Buckets auf einmal. Liefert URLs in gleicher Reihenfolge. */
  signBatch: (bucket: string, paths: string[], expiresIn: number) => Promise<(string | null)[]>
  expiresIn?: number
  /** Sicherheitsabstand vor Ablauf, ab dem neu signiert wird. */
  refreshMarginMs?: number
  now?: () => number
}

interface Entry {
  url: string
  expiresAt: number
}

interface Pending {
  path: string
  resolve: (url: string) => void
  reject: (err: Error) => void
}

export function createSignedUrlCache(options: SignedUrlCacheOptions) {
  const expiresIn = options.expiresIn ?? 3600
  const margin = options.refreshMarginMs ?? 5 * 60 * 1000
  const now = options.now ?? Date.now
  const cache = new Map<string, Entry>()
  const inflight = new Map<string, Promise<string>>()
  const queue = new Map<string, Pending[]>()
  let scheduled = false

  async function flush() {
    scheduled = false
    const batches = [...queue.entries()]
    queue.clear()
    await Promise.all(
      batches.map(async ([bucket, pending]) => {
        const paths = [...new Set(pending.map((p) => p.path))]
        try {
          const urls = await options.signBatch(bucket, paths, expiresIn)
          const byPath = new Map(paths.map((p, i) => [p, urls[i]]))
          for (const p of pending) {
            const url = byPath.get(p.path)
            if (url) {
              cache.set(`${bucket}/${p.path}`, { url, expiresAt: now() + expiresIn * 1000 })
              p.resolve(url)
            } else {
              p.reject(new Error(`Keine URL für ${p.path}`))
            }
          }
        } catch (err) {
          pending.forEach((p) => p.reject(err as Error))
        }
      }),
    )
  }

  return {
    get(bucket: string, path: string): Promise<string> {
      const key = `${bucket}/${path}`
      const hit = cache.get(key)
      if (hit && hit.expiresAt - margin > now()) return Promise.resolve(hit.url)
      const running = inflight.get(key)
      if (running) return running
      const promise = new Promise<string>((resolve, reject) => {
        const list = queue.get(bucket) ?? []
        list.push({ path, resolve, reject })
        queue.set(bucket, list)
        if (!scheduled) {
          scheduled = true
          queueMicrotask(() => void flush())
        }
      }).finally(() => inflight.delete(key))
      inflight.set(key, promise)
      return promise
    },
    invalidate(bucket: string, path: string) {
      cache.delete(`${bucket}/${path}`)
    },
  }
}
