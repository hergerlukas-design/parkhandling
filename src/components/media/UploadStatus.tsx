import { useEffect, useState } from 'react'
import { uploadQueue, useUploadQueue } from '../../lib/media/mediaService'
import { Icon } from '../Icon'

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** Sichtbarer Upload-Status: wartende, laufende und fehlgeschlagene Uploads. */
export function UploadStatus() {
  const { items, pending, uploading, failed } = useUploadQueue()
  const online = useOnline()
  if (items.length === 0 && online) return null

  const text = !online
    ? `Offline${items.length ? ` · ${items.length} Datei${items.length === 1 ? '' : 'en'} warten` : ''}`
    : uploading
      ? `Lädt hoch … (${pending + uploading} offen)`
      : failed
        ? `${failed} Upload${failed === 1 ? '' : 's'} fehlgeschlagen – erneut versuchen`
        : `${pending} Datei${pending === 1 ? '' : 'en'} warten auf Upload`

  return (
    <button
      type="button"
      onClick={() => items.filter((i) => i.status !== 'uploading').forEach((i) => void uploadQueue.retry(i.id))}
      className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs font-medium ${
        failed ? 'bg-red-50 text-red-700' : !online ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'
      }`}
    >
      <Icon name={online ? 'upload' : 'cloudOff'} className={`size-4 ${uploading ? 'animate-pulse' : ''}`} />
      {text}
    </button>
  )
}
