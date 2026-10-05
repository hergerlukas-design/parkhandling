import type { SupabaseClient } from '@supabase/supabase-js'
import { createSignedUrlCache } from './signedUrlCache'
import type { MediaRef, MediaStore, UploadRequest, UploadTicket, UploadTarget } from './types'

const ARCHIVE_BUCKET = 'media-archive'
/** Dateinamen sind unveränderlich (<uuid>.webp) → ein Jahr cachen. */
const CACHE_CONTROL = 'max-age=31536000, immutable'

interface SignResponse {
  media_id: string
  provider: 'supabase'
  bucket: string
  path: string
  thumb_path: string | null
  upload_url: string
  thumb_upload_url: string | null
  expires_at: string
}

export function createSupabaseMediaStore(client: SupabaseClient, anonKey: string): MediaStore {
  const urlCache = createSignedUrlCache({
    async signBatch(bucket, paths, expiresIn) {
      const { data, error } = await client.storage.from(bucket).createSignedUrls(paths, expiresIn)
      if (error) throw error
      const byPath = new Map(data.map((d) => [d.path, d.signedUrl]))
      return paths.map((p) => byPath.get(p) ?? null)
    },
  })

  const target = (url: string, contentType: string): UploadTarget => ({
    url,
    method: 'PUT',
    headers: {
      apikey: anonKey,
      'content-type': contentType,
      'cache-control': CACHE_CONTROL,
      'x-upsert': 'false',
    },
  })

  return {
    provider: 'supabase',

    async getUploadUrl(req: UploadRequest): Promise<UploadTicket> {
      const { data, error } = await client.functions.invoke<SignResponse>('media-sign', {
        body: {
          booking_id: req.bookingId,
          owner_type: req.ownerType,
          owner_id: req.ownerId,
          kind: req.kind,
          content_type: req.contentType,
          bytes: req.bytes,
          thumb_content_type: req.thumbContentType,
          thumb_bytes: req.thumbBytes,
          width: req.width,
          height: req.height,
          taken_at: req.takenAt,
          device_id: req.deviceId,
        },
      })
      if (error || !data) throw error ?? new Error('media-sign ohne Antwort')
      return {
        mediaId: data.media_id,
        provider: data.provider,
        bucket: data.bucket,
        path: data.path,
        thumbPath: data.thumb_path,
        file: target(data.upload_url, req.contentType),
        thumb:
          data.thumb_upload_url && req.thumbContentType
            ? target(data.thumb_upload_url, req.thumbContentType)
            : null,
        expiresAt: data.expires_at,
      }
    },

    getViewUrl(ref: MediaRef, options) {
      if (options?.expiresIn) {
        return client.storage
          .from(ref.bucket)
          .createSignedUrl(ref.path, options.expiresIn)
          .then(({ data, error }) => {
            if (error || !data) throw error ?? new Error('Keine URL')
            return data.signedUrl
          })
      }
      return urlCache.get(ref.bucket, ref.path)
    },

    async delete(ref: MediaRef) {
      const { error } = await client.storage.from(ref.bucket).remove([ref.path])
      if (error) throw error
      urlCache.invalidate(ref.bucket, ref.path)
    },

    async archive(ref: MediaRef): Promise<MediaRef> {
      if (ref.bucket === ARCHIVE_BUCKET) return ref
      const { error } = await client.storage
        .from(ref.bucket)
        .move(ref.path, ref.path, { destinationBucket: ARCHIVE_BUCKET })
      if (error) throw error
      urlCache.invalidate(ref.bucket, ref.path)
      return { ...ref, bucket: ARCHIVE_BUCKET }
    },
  }
}
