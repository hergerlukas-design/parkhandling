import {
  domCanvasFactory,
  processImageBlob,
  SIGNATURE_SPEC,
  type EncodeSpec,
  type ProcessedImage,
} from './imageProcessing'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: ProcessedImage) => void; reject: (e: Error) => void }>()

function supportsWorkerPipeline(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    'convertToBlob' in OffscreenCanvas.prototype &&
    typeof createImageBitmap !== 'undefined'
  )
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ id: number; result?: ProcessedImage; error?: string }>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    pending.delete(event.data.id)
    if (event.data.result) job.resolve(event.data.result)
    else job.reject(new Error(event.data.error ?? 'Bildverarbeitung fehlgeschlagen'))
  }
  worker.onerror = (event) => {
    pending.forEach((job) => job.reject(new Error(event.message || 'Worker-Fehler')))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

async function run(file: Blob, thumbnail: boolean, spec?: EncodeSpec): Promise<ProcessedImage> {
  if (supportsWorkerPipeline()) {
    try {
      return await new Promise<ProcessedImage>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        getWorker().postMessage({ id, file, thumbnail, spec })
      })
    } catch {
      // z. B. Worker blockiert → Hauptthread-Fallback
    }
  }
  return processImageBlob(file, domCanvasFactory, { thumbnail, spec })
}

/**
 * Foto → WebP-Vollbild + Thumbnail (320 px, ~20 KB), ohne EXIF.
 * Standard: ≤ 1600 px, ~250 KB. Mit `fullSpec` z. B. DAMAGE_FULL_SPEC für Schadensfotos.
 */
export function processPhoto(file: Blob, fullSpec?: EncodeSpec): Promise<ProcessedImage> {
  return run(file, true, fullSpec)
}

/** Unterschrift → verkleinertes PNG, ohne Thumbnail. */
export function processSignature(png: Blob): Promise<ProcessedImage> {
  return run(png, false, SIGNATURE_SPEC)
}
