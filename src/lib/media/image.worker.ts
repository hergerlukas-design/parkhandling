/// <reference lib="webworker" />
import { offscreenCanvasFactory, processImageBlob, type EncodeSpec } from './imageProcessing'

interface Job {
  id: number
  file: Blob
  thumbnail: boolean
  spec?: EncodeSpec
}

self.onmessage = async (event: MessageEvent<Job>) => {
  const { id, file, thumbnail, spec } = event.data
  try {
    const result = await processImageBlob(file, offscreenCanvasFactory, { thumbnail, spec })
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message ?? String(err) })
  }
}
