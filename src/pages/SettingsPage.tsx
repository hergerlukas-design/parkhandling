import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Card, Page } from '../components/Page'
import { formatBytes, formatDateTime } from '../lib/format'
import { useStore } from '../lib/store'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { checkForUpdate, updateStore } from '../lib/update/updateController'
import { APP_VERSION, BUILD_TIME } from '../lib/version'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}

interface MediaUsage {
  file_count: number
  total_bytes: number
  pending_count: number
}

function useMediaUsage() {
  const [usage, setUsage] = useState<MediaUsage | null>(null)
  useEffect(() => {
    supabase
      ?.rpc('media_usage')
      .single<MediaUsage>()
      .then(({ data }) => data && setUsage(data))
  }, [])
  return usage
}

export function SettingsPage() {
  const update = useStore(updateStore)
  const usage = useMediaUsage()

  return (
    <Page title="Einstellungen">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="App & Version">
          <dl>
            <Row label="Installierte Version">{APP_VERSION}</Row>
            <Row label="Build">{formatDateTime(BUILD_TIME)}</Row>
            <Row label="Server-Version">{update.remoteVersion ?? '–'}</Row>
            <Row label="Zuletzt geprüft">
              {update.lastCheckedAt ? formatDateTime(update.lastCheckedAt) : '–'}
            </Row>
            <Row label="Datenbank">{isSupabaseConfigured ? 'verbunden' : 'nicht konfiguriert'}</Row>
            <Row label="Speicherverbrauch">{usage ? formatBytes(Number(usage.total_bytes)) : '–'}</Row>
            <Row label="Dateien">
              {usage ? `${usage.file_count}${usage.pending_count ? ` (${usage.pending_count} unbestätigt)` : ''}` : '–'}
            </Row>
          </dl>
          {update.error && <p className="mt-2 text-sm text-red-600">{update.error}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void checkForUpdate()}
              className="touch-target rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Nach Updates suchen
            </button>
            <Link
              to="/changelog"
              className="touch-target inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
            >
              Änderungsprotokoll
            </Link>
          </div>
        </Card>
        <Card title="Betrieb">
          <p className="text-sm text-slate-600">
            Leistungskatalog, Stellplätze/QR-Codes, Shuttle-Betriebszeiten und Mail-Vorlagen folgen
            mit den jeweiligen Umsetzungsschritten.
          </p>
        </Card>
      </div>
    </Page>
  )
}
