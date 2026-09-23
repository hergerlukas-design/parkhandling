import { useState } from 'react'
import { fullRef, thumbRef, useMediaUrl, useObjectUrl } from '../../lib/media/mediaService'
import type { QueueItem } from '../../lib/media/uploadQueue'
import type { Media } from '../../types/domain'
import { Icon } from '../Icon'
import { Lightbox } from './Lightbox'

const box = 'relative size-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:size-24'

/** Zeigt ausschließlich das Thumbnail; das Vollbild wird erst in der Lightbox geladen. */
export function MediaThumb({
  media,
  alt = 'Foto',
}: {
  media: Pick<Media, 'provider' | 'bucket' | 'path' | 'thumb_path'>
  alt?: string
}) {
  const [open, setOpen] = useState(false)
  const { url, error } = useMediaUrl(thumbRef(media))
  return (
    <>
      <button type="button" className={box} onClick={() => setOpen(true)} aria-label={`${alt} vergrößern`}>
        {url ? (
          <img src={url} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-slate-400">
            <Icon name={error ? 'cloudOff' : 'image'} />
          </span>
        )}
      </button>
      {open && <Lightbox media={fullRef(media)} alt={alt} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Lokale Vorschau eines Fotos, das noch in der Upload-Queue liegt. */
export function PendingThumb({ item }: { item: QueueItem }) {
  const url = useObjectUrl(item.thumb ?? item.full)
  const label =
    item.status === 'failed' ? 'Fehler' : item.status === 'uploading' ? 'Lädt hoch' : 'Wartet'
  return (
    <div className={box} title={item.lastError ?? label}>
      {url && <img src={url} alt="" className="size-full object-cover opacity-70" />}
      <span
        className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-0.5 text-[10px] font-semibold text-white ${
          item.status === 'failed' ? 'bg-red-600' : 'bg-slate-900/70'
        }`}
      >
        <Icon name={item.status === 'failed' ? 'cloudOff' : 'upload'} className="size-3" />
        {label}
      </span>
    </div>
  )
}
