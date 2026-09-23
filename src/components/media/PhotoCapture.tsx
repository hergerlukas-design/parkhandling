import { useRef, useState } from 'react'
import { addPhotos, type MediaOwner } from '../../lib/media/mediaService'
import { Icon } from '../Icon'

/** Kamera/Galerie öffnen, Fotos im Browser komprimieren und in die Upload-Queue legen. */
export function PhotoCapture({ owner, label = 'Foto aufnehmen' }: { owner: MediaOwner; label?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      await addPhotos(Array.from(files), owner)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
      >
        <Icon name="image" className="size-5" />
        {busy ? 'Wird verarbeitet …' : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
