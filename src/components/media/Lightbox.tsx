import { useEffect } from 'react'
import type { MediaRef } from '../../lib/media/types'
import { useMediaUrl } from '../../lib/media/mediaService'
import { Icon } from '../Icon'

/** Vollbild erst beim Antippen laden (Abschnitt 11.2). */
export function Lightbox({ media, alt, onClose }: { media: MediaRef; alt: string; onClose: () => void }) {
  const { url, error } = useMediaUrl(media)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Schließen"
        className="touch-target absolute top-3 right-3 flex items-center justify-center rounded-full bg-white/10 text-white"
      >
        <Icon name="close" />
      </button>
      {error && <p className="text-sm text-red-300">Bild konnte nicht geladen werden.</p>}
      {!error && !url && <p className="text-sm text-white/70">Lädt …</p>}
      {url && (
        <img
          src={url}
          alt={alt}
          decoding="async"
          className="max-h-full max-w-full rounded object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  )
}
