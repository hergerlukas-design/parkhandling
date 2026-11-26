import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui'

/**
 * Unterschriftenfeld (Finger/Stift/Maus). Liefert beim Übernehmen ein PNG,
 * das über den Media-Service hochgeladen wird.
 */
export function SignaturePad({
  onConfirm,
  onCancel,
  label,
}: {
  onConfirm: (png: Blob) => void
  onCancel: () => void
  label: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current!
    // Größenänderung (Tastatur, Adressleiste, Drehen) darf das Gezeichnete nicht löschen:
    // nur bei echter Größenänderung neu aufbauen und den bisherigen Inhalt übernehmen
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = c.getBoundingClientRect()
      const width = Math.round(rect.width * ratio)
      const height = Math.round(rect.height * ratio)
      if (width === c.width && height === c.height) return
      let snapshot: HTMLCanvasElement | null = null
      if (c.width > 0 && c.height > 0) {
        snapshot = document.createElement('canvas')
        snapshot.width = c.width
        snapshot.height = c.height
        snapshot.getContext('2d')!.drawImage(c, 0, 0)
      }
      c.width = width
      c.height = height
      const ctx = c.getContext('2d')!
      if (snapshot) ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, width, height)
      ctx.scale(ratio, ratio)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#0b1f3a'
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  function point(e: React.PointerEvent) {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function down(e: React.PointerEvent) {
    e.preventDefault()
    canvas.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
    const ctx = canvas.current!.getContext('2d')!
    ctx.beginPath()
    ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2)
    ctx.fill()
    setEmpty(false)
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current || !last.current) return
    const p = point(e)
    const ctx = canvas.current!.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  function up() {
    drawing.current = false
    last.current = null
  }

  function clear() {
    const c = canvas.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  function confirm() {
    canvas.current!.toBlob((b) => b && onConfirm(b), 'image/png')
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-subtle">{label}</p>
      <canvas
        ref={canvas}
        aria-label={label}
        className="h-48 w-full touch-none rounded-xl border-2 border-dashed border-line-strong bg-white sm:h-56"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button onClick={clear} disabled={empty}>Löschen</Button>
        <Button variant="primary" onClick={confirm} disabled={empty}>Unterschrift übernehmen</Button>
      </div>
    </div>
  )
}
