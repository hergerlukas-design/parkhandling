import { describe, expect, it, vi } from 'vitest'
import { createSignedUrlCache } from './signedUrlCache'

describe('createSignedUrlCache', () => {
  it('fasst Anfragen eines Ticks pro Bucket zu einem Batch zusammen', async () => {
    const signBatch = vi.fn(async (bucket: string, paths: string[]) => paths.map((p) => `https://x/${bucket}/${p}?sig`))
    const cache = createSignedUrlCache({ signBatch })
    const urls = await Promise.all([cache.get('media', 'a'), cache.get('media', 'b'), cache.get('media', 'a')])
    expect(urls).toEqual(['https://x/media/a?sig', 'https://x/media/b?sig', 'https://x/media/a?sig'])
    expect(signBatch).toHaveBeenCalledTimes(1)
    expect(signBatch.mock.calls[0][1]).toEqual(['a', 'b'])
  })

  it('liefert gleiche URL bis kurz vor Ablauf und signiert dann neu', async () => {
    let t = 0
    let n = 0
    const cache = createSignedUrlCache({
      signBatch: async (_b, paths) => paths.map(() => `u${++n}`),
      expiresIn: 3600,
      refreshMarginMs: 300_000,
      now: () => t,
    })
    expect(await cache.get('media', 'a')).toBe('u1')
    t = 3_000_000
    expect(await cache.get('media', 'a')).toBe('u1')
    t = 3_400_000
    expect(await cache.get('media', 'a')).toBe('u2')
  })

  it('meldet Fehler an alle Wartenden', async () => {
    const cache = createSignedUrlCache({ signBatch: async () => Promise.reject(new Error('offline')) })
    await expect(cache.get('media', 'a')).rejects.toThrow('offline')
  })
})
