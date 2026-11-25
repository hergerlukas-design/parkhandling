import { Link, useSearchParams } from 'react-router'
import { Card, CollapsibleCard, Page } from '../components/Page'
import { isAdminProfile, isDayAccess, isDriverOnly, isStaffProfile, profileRoles, signOut, signOutToScanner, useAuth } from '../lib/auth'
import { formatDateTime } from '../lib/format'
import { useStore } from '../lib/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { checkForUpdate, updateStore } from '../lib/update/updateController'
import { NotificationAdmin } from '../components/notifications/NotificationAdmin'
import { NotificationLog } from '../components/notifications/NotificationLog'
import { NotificationSettings } from '../components/notifications/NotificationSettings'
import { AppearanceSettings } from '../components/settings/AppearanceSettings'
import { SiteLayoutSettings } from '../components/siteplan/SiteLayoutSettings'
import { HelperAccess } from '../components/users/HelperAccess'
import { ScannerPinSettings } from '../components/users/ScannerPinSettings'
import { UserManagement } from '../components/users/UserManagement'
import { rolesLabel } from '../lib/users'
import { APP_VERSION, BUILD_TIME } from '../lib/version'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}

type SettingsTab = 'allgemein' | 'team' | 'halle'

/** Reiter der Einstellungen; weitere Bereiche kommen als eigener Reiter dazu */
const TABS: { id: SettingsTab; label: string; short: string }[] = [
  { id: 'allgemein', label: 'Allgemein', short: 'Allgemein' },
  { id: 'team', label: 'Team & Benachrichtigungen', short: 'Team' },
  { id: 'halle', label: 'Halle & Stellplätze', short: 'Halle' },
]

export function SettingsPage() {
  const update = useStore(updateStore)
  const { session, profile } = useAuth()
  const admin = isAdminProfile(profile)
  const driverOnly = isDriverOnly(profile)
  // Reiner Fahrer: Halle & Stellplätze hat für ihn keinen Inhalt
  const tabs = TABS.filter((t) => t.id !== 'halle' || !driverOnly)
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: SettingsTab = tabs.some((t) => t.id === requested) ? (requested as SettingsTab) : 'allgemein'

  return (
    <Page title="Einstellungen">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" role="tablist" aria-label="Bereiche">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'allgemein' ? {} : { tab: t.id }, { replace: true })}
            className={`touch-target shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap ${
              tab === t.id ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink'
            }`}
          >
            <span className="md:hidden">{t.short}</span>
            <span className="hidden md:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'allgemein' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0" role="tabpanel">
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
                className="btn-primary touch-target rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
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
          <Card title="Darstellung">
            <AppearanceSettings />
          </Card>
          <Card title="Konto">
            <dl>
              <Row label="Angemeldet als">{session?.user.email ?? '–'}</Row>
              <Row label="Rollen">{rolesLabel(profileRoles(profile))}</Row>
            </dl>
            <button
              type="button"
              onClick={() => void (isDayAccess(profile) ? signOutToScanner() : signOut())}
              className="touch-target mt-4 rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold"
            >
              Abmelden
            </button>
          </Card>
        </div>
      )}

      {tab === 'team' && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0" role="tabpanel">
          <CollapsibleCard title="Benachrichtigungen auf diesem Gerät" storageKey="team-notifications-device">
            <NotificationSettings />
          </CollapsibleCard>
          {admin && (
            <CollapsibleCard title="Benachrichtigungen: Einstellungen & Geräte" storageKey="team-notifications-admin">
              <NotificationAdmin />
            </CollapsibleCard>
          )}
          {admin && (
            <CollapsibleCard title="Letzte Benachrichtigungen" storageKey="team-notifications-log">
              <NotificationLog />
            </CollapsibleCard>
          )}
          {isStaffProfile(profile) && !profile?.access_until && (
            <CollapsibleCard title="Tageszugang per QR" storageKey="team-day-access">
              <HelperAccess />
            </CollapsibleCard>
          )}
          {admin && (
            <CollapsibleCard title="Scanner-PIN" storageKey="team-scanner-pin">
              <ScannerPinSettings />
            </CollapsibleCard>
          )}
          {admin && (
            <CollapsibleCard title="Personal" storageKey="team-staff">
              <UserManagement />
            </CollapsibleCard>
          )}
        </div>
      )}

      {tab === 'halle' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0" role="tabpanel">
          {admin && (
            <Card title="Stellplätze: Halle & Außenfläche">
              <SiteLayoutSettings />
            </Card>
          )}
          <Card title="Stellplätze & Schlüsselfächer">
            <p className="text-sm text-subtle">
              Jeder Parkplatz in Halle und Außenfläche hat genau ein Schlüsselfach mit demselben Code.
            </p>
            <Link
              to="/stellplaetze"
              className="touch-target mt-3 inline-flex items-center rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold"
            >
              Stellplätze/QR-Codes
            </Link>
          </Card>
        </div>
      )}
    </Page>
  )
}
