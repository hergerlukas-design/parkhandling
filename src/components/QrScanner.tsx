import { useEffect, useRef, useState, type FormEvent } from 'react'

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => Detector
  }
}

/**
 * Kamera-QR-Scanner. Nutzt den BarcodeDetector des Browsers (Chrome/Android), sonst jsQR
 * (Safari/iPadOS). Manuelle Eingabe ist immer möglich (Handschuhe, schlechtes Licht, keine Kamera).
 */
export function QrScanner({
  onResult,
  label = 'QR-Code scannen',
  paused = false,
}: {
  onResult: (text: string) => void
  label?: string
  paused?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const last = useRef<{ text: string; at: number } | null>(null)
  const callback = useRef(onResult)
  callback.current = onResult

  useEffect(() => {
    if (paused) return
    let stream: MediaStream | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Kamera nicht verfügbar – Code bitte eingeben.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch {
        setError('Kein Kamerazugriff – Code bitte eingeben.')
        return
      }
      if (stopped || !video.current) return
      video.current.srcObject = stream
      await video.current.play().catch(() => undefined)

      const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null
      const jsQR = detector ? null : (await import('jsqr')).default
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      const tick = async () => {
        if (stopped || !video.current) return
        const v = video.current
        let text: string | null = null
        try {
          if (v.readyState >= 2) {
            if (detector) {
              text = (await detector.detect(v))[0]?.rawValue ?? null
            } else if (jsQR && ctx) {
              const w = 480
              const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360
              canvas.width = w
              canvas.height = h
              ctx.drawImage(v, 0, 0, w, h)
              text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null
            }
          }
        } catch {
          // einzelne Frames dürfen fehlschlagen
        }
        const now = Date.now()
        if (text && !(last.current && last.current.text === text && now - last.current.at < 2500)) {
          last.current = { text, at: now }
          navigator.vibrate?.(60)
          callback.current(text)
        }
        timer = setTimeout(() => void tick(), 200)
      }
      void tick()
    }

    void start()
    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [paused])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (manual.trim()) {
      callback.current(manual.trim())
      setManual('')
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-ink p-4 text-white">
      <div className="relative aspect-square w-full max-w-64 overflow-hidden rounded-2xl border-4 border-white/90">
        {!error && <video ref={video} muted playsInline className="size-full object-cover" />}
        {error && <div className="flex size-full items-center justify-center p-4 text-center text-sm text-white/80">{error}</div>}
      </div>
      <p className="text-sm text-white/80">{label}</p>
      <form onSubmit={submit} className="flex w-full max-w-64 gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="z. B. K-018 oder R7-E2"
          autoCapitalize="characters"
          aria-label="Code manuell eingeben"
          className="touch-target min-w-0 flex-1 rounded-lg bg-white/10 px-3 text-base text-white placeholder:text-white/50"
        />
        <button type="submit" className="touch-target rounded-lg bg-white px-3 text-sm font-semibold text-ink">OK</button>
      </form>
    </div>
  )
}
