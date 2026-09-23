import { Link } from 'react-router'
import { useStore } from '../lib/store'
import { applyUpdate, updateStore } from '../lib/update/updateController'
import { useUpdateBlockers } from '../lib/update/updateGuard'
import { Icon } from './Icon'

/**
 * Nicht-blockierendes Update-Banner. Bei Major-Versionen (Schemaänderung) wird daraus
 * ein Pflicht-Dialog – aber erst, wenn kein Protokoll/Check-in mehr offen ist.
 */
export function UpdateBanner() {
  const state = useStore(updateStore)
  const blockers = useUpdateBlockers()

  if (state.kind === 'none') return null

  const version = state.remoteVersion ?? 'neu'
  const blocked = blockers.length > 0
  const mandatory = state.kind === 'major'

  const button = (
    <button
      type="button"
      onClick={() => void applyUpdate()}
      disabled={blocked || state.applying}
      className="touch-target inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon name="refresh" className={`size-4 ${state.applying ? 'animate-spin' : ''}`} />
      {state.applying ? 'Wird aktualisiert …' : blocked ? 'Nach Abschluss aktualisieren' : 'Aktualisieren'}
    </button>
  )

  if (mandatory && !blocked) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
      >
        <div className="w-full max-w-md rounded-2xl bg-brand-700 p-6 text-white shadow-2xl">
          <h2 id="update-title" className="text-lg font-semibold">
            Pflicht-Update auf Version {version}
          </h2>
          <p className="mt-2 text-sm text-brand-100">
            Diese Version enthält Änderungen an der Datenstruktur. Bitte jetzt aktualisieren, um
            weiterzuarbeiten. Entwürfe bleiben erhalten.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Link to="/changelog" className="text-sm underline underline-offset-2">
              Änderungen ansehen
            </Link>
            {button}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm text-white ${
        mandatory ? 'bg-amber-600' : 'bg-brand-700'
      }`}
    >
      <span className="font-medium">
        {mandatory ? 'Pflicht-Update' : 'Neue Version'} {version} verfügbar
      </span>
      {blocked && (
        <span className="text-white/80">
          Wird nach Abschluss eingespielt: {blockers.join(', ')}
        </span>
      )}
      <Link to="/changelog" className="underline underline-offset-2">
        Änderungen
      </Link>
      <span className="ml-auto">{button}</span>
    </div>
  )
}
