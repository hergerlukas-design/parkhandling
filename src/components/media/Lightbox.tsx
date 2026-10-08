import { useEffect, useRef, useState, type TouchEvent } from 'react'
import type { MediaRef } from '../../lib/media/types'
import { useMediaUrl } from '../../lib/media/mediaService'
import { Icon } from '../Icon'

const MIN_SCALE = 1
const MAX_SCALE = 5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
const DOUBLE_TAP_SCALE = 2.5

interface View {
  scale: number
  x: number
  y: number
}

const RESET: View = { scale: 1, x: 0, y: 0 }

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function distance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * Vollbild erst beim Antippen laden (Abschnitt 11.2).
 * Pinch-to-Zoom mit zwei Fingern, Verschieben im vergrößerten Bild, Doppeltippen zum Ein- und Auszoomen.
 */
export function Lightbox({ media, alt, onClose }: { media: MediaRef; alt: string; onClose: () => void }) {
  const { url, error } = useMediaUrl(media)
  const [view, setView] = useState<View>(RESET)
  const frame = useRef<HTMLDivElement>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const pan = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const tap = useRef<{ time: number; x: number; y: number; moved: boolean } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Zoomen mit Ankerpunkt: der Punkt unter dem Finger bleibt an Ort und Stelle */
  function zoomAt(scale: number, clientX: number, clientY: number) {
    const rect = frame.current?.getBoundingClientRect()
    if (!rect || scale <= MIN_SCALE) return setView(RESET)
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    setView({ scale, x: (cx - clientX) * (scale - 1), y: (cy - clientY) * (scale - 1) })
  }

  function onDoubleTap(clientX: number, clientY: number) {
    const current = viewRef.current
    if (current.scale > MIN_SCALE) setView(RESET)
    else zoomAt(DOUBLE_TAP_SCALE, clientX, clientY)
  }

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2) {
      pinch.current = { dist: distance(e.touches[0], e.touches[1]), scale: viewRef.current.scale }
      pan.current = null
      tap.current = null
      return
    }
    if (e.touches.length === 1) {
      const t = e.touches[0]
      const v = viewRef.current
      pan.current = { x: v.x, y: v.y, startX: t.clientX, startY: t.clientY }
      const previous = tap.current
      if (previous && Date.now() - previous.time < DOUBLE_TAP_MS && Math.hypot(t.clientX - previous.x, t.clientY - previous.y) < DOUBLE_TAP_PX) {
        tap.current = null
        onDoubleTap(t.clientX, t.clientY)
        return
      }
      tap.current = { time: Date.now(), x: t.clientX, y: t.clientY, moved: false }
    }
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2 && pinch.current) {
      const ratio = distance(e.touches[0], e.touches[1]) / pinch.current.dist
      const scale = clamp(pinch.current.scale * ratio, MIN_SCALE, MAX_SCALE)
      if (scale <= MIN_SCALE) setView(RESET)
      else setView((v) => ({ ...v, scale }))
      return
    }
    if (e.touches.length === 1 && pan.current) {
      const t = e.touches[0]
      if (tap.current && Math.hypot(t.clientX - tap.current.x, t.clientY - tap.current.y) > 10) tap.current.moved = true
      if (viewRef.current.scale > MIN_SCALE) {
        setView((v) => ({
          ...v,
          x: pan.current!.x + (t.clientX - pan.current!.startX),
          y: pan.current!.y + (t.clientY - pan.current!.startY),
        }))
      }
    }
  }

  function onTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) {
      pinch.current = null
      pan.current = null
      if (viewRef.current.scale <= MIN_SCALE) setView(RESET)
    }
    if (e.touches.length === 1) pinch.current = null
  }

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
        className="touch-target absolute top-3 right-3 z-10 flex items-center justify-center rounded-full bg-white/10 text-white"
      >
        <Icon name="close" />
      </button>
      {error && <p className="text-sm text-danger-soft">Bild konnte nicht geladen werden.</p>}
      {!error && !url && <p className="text-sm text-white/70">Lädt …</p>}
      {url && (
        <div
          ref={frame}
          className="flex size-full items-center justify-center overflow-hidden"
          style={{ touchAction: 'none' }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <img
            src={url}
            alt={alt}
            decoding="async"
            draggable={false}
            onDoubleClick={(e) => onDoubleTap(e.clientX, e.clientY)}
            className="max-h-full max-w-full origin-center rounded object-contain select-none"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: pinch.current || pan.current ? 'none' : 'transform 150ms ease-out',
            }}
          />
        </div>
      )}
      {url && view.scale > MIN_SCALE && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setView(RESET)
          }}
          className="absolute bottom-4 rounded-full bg-white/15 px-4 py-2 text-sm text-white"
        >
          Zoom zurücksetzen
        </button>
      )}
    </div>
  )
}
