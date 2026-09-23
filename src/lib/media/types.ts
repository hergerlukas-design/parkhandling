import type { MediaKind, MediaOwnerType, MediaProvider } from '../../types/domain'

/** Speicherort einer Datei. Die DB speichert provider + bucket + path, nie eine fertige URL. */
export interface MediaRef {
  provider: MediaProvider
  bucket: string
  path: string
}

export interface UploadRequest {
  bookingId: string | null
  ownerType: MediaOwnerType
  ownerId: string | null
  kind: MediaKind
  contentType: string
  bytes: number
  thumbContentType: string | null
  thumbBytes: number | null
  width: number | null
  height: number | null
  takenAt: string | null
  deviceId: string
}

/** Provider-neutrales Upload-Ziel: das Gerät lädt direkt per HTTP PUT hoch. */
export interface UploadTarget {
  url: string
  method: 'PUT'
  headers: Record<string, string>
}

export interface UploadTicket {
  mediaId: string
  provider: MediaProvider
  bucket: string
  path: string
  thumbPath: string | null
  file: UploadTarget
  thumb: UploadTarget | null
  expiresAt: string
}

export interface ViewUrlOptions {
  /** Gültigkeit der Signed URL in Sekunden (Standard 1 h). */
  expiresIn?: number
}

/**
 * Einziger Zugriffspunkt auf den Datei-Speicher. Ein Wechsel auf ein anderes
 * Object Storage (z. B. Cloudflare R2) erfordert nur eine neue Implementierung.
 */
export interface MediaStore {
  readonly provider: MediaProvider
  getUploadUrl(request: UploadRequest): Promise<UploadTicket>
  getViewUrl(ref: MediaRef, options?: ViewUrlOptions): Promise<string>
  delete(ref: MediaRef): Promise<void>
  /** Verschiebt die Datei ins Archiv und liefert den neuen Speicherort. */
  archive(ref: MediaRef): Promise<MediaRef>
}
