import { Link } from 'react-router'
import { Card, Page } from '../components/Page'
import { signOut, useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/format'
import { useStore } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { checkForUpdate, updateStore } from '../lib/update/updateController'
import { UserManagement } from '../components/users/UserManagement'
import { APP_VERSION, BUILD_TIME } from '../lib/version'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}

export function SettingsPage() {
  const update = useStore(updateStore)
  const { session, profile } = useAuth()

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
          </dl>
          {update.error && <p className="mt-2 text-sm text-danger">{update.error}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void checkForUpdate()}
              className="touch-target rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
            >
              Nach Updates suchen
            </button>
            <Link
              to="/changelog"
              className="touch-target inline-flex items-center rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold"
            >
              Änderungsprotokoll
            </Link>
          </div>
        </Card>
        <Card title="Konto">
          <dl>
            <Row label="Angemeldet als">{session?.user.email ?? '–'}</Row>
            <Row label="Rolle">{profile?.role === 'admin' ? 'Admin' : 'Personal'}</Row>
          </dl>
          <button
            type="button"
            onClick={() => void signOut()}
            className="touch-target mt-4 rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold"
          >
            Abmelden
          </button>
        </Card>
        {profile?.role === 'admin' && (
          <Card title="Personal">
            <UserManagement />
          </Card>
        )}
        <Card title="Betrieb">
          <p className="text-sm text-subtle">
            Jeder Stellplatz in Halle und Außenfläche hat einen Schlüsselanhänger mit seinem Code und QR-Code.
          </p>
          <Link
            to="/schluesselanhaenger"
            className="touch-target mt-3 inline-flex items-center rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold"
          >
            Schlüsselanhänger drucken
          </Link>
          <p className="mt-3 text-sm text-subtle">Leistungskatalog, Stellplatz-Schilder und Mail-Testadresse folgen in Phase 1.</p>
        </Card>
      </div>
    </Page>
  )
}
