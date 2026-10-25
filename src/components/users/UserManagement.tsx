import { useEffect, useState, type FormEvent } from 'react'
import { ROLE_ORDER, useAuth, type Role } from '../../lib/auth'
import { canChangeStaff, inviteStaff, listStaff, ROLE_LABEL, toggleRole, updateStaff, type StaffProfile } from '../../lib/users'
import { Button, Dialog, ErrorList, Field, TextInput } from '../ui'

const ROLE_HINT: Record<Role, string> = {
  admin: 'alles inkl. Personal, Einstellungen',
  staff: 'Buchungen, Lageplan, Aufgaben, Shuttle',
  driver: 'Fahrerliste; allein nur Shuttle-Ansicht',
}

/** Rollen als Mehrfachauswahl (mindestens eine bleibt gewählt) */
function RolePicker({ value, onChange, disabled, compact }: {
  value: Role[]
  onChange: (roles: Role[]) => void
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? '' : 'flex-col'}`} role="group" aria-label="Rollen">
      {ROLE_ORDER.map((role) => {
        const on = value.includes(role)
        return compact ? (
          <button key={role} type="button" aria-pressed={on} disabled={disabled}
            onClick={() => onChange(toggleRole(value, role, !on))}
            className={`touch-target rounded-full px-3 text-sm font-semibold disabled:opacity-60 ${on ? 'bg-ink text-white' : 'bg-chip text-subtle hover:bg-line'}`}>
            {ROLE_LABEL[role]}
          </button>
        ) : (
          <label key={role} className="touch-target flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-accent" checked={on} disabled={disabled}
              onChange={(e) => onChange(toggleRole(value, role, e.target.checked))} />
            <span className="font-medium text-ink">{ROLE_LABEL[role]}</span>
            <span className="text-xs text-muted">{ROLE_HINT[role]}</span>
          </label>
        )
      })}
    </div>
  )
}

export function UserManagement() {
  const { session } = useAuth()
  const [staff, setStaff] = useState<StaffProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      setStaff(await listStaff())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function change(target: StaffProfile, patch: Partial<Pick<StaffProfile, 'roles' | 'active'>>) {
    const blocked = canChangeStaff(target, patch, staff)
    if (blocked) return setError(blocked)
    if (target.id === session?.user.id && patch.active === false) {
      return setError('Das eigene Konto kann nicht deaktiviert werden.')
    }
    try {
      await updateStaff(target.id, patch)
      setError(null)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ErrorList errors={error ? [error] : []} />
      {loading ? (
        <p className="text-sm text-muted">Lädt …</p>
      ) : (
        <ul className="divide-y divide-line">
          {staff.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.display_name || p.email || '–'}</p>
                <p className="truncate text-xs text-muted">{p.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RolePicker compact value={p.roles?.length ? p.roles : [p.role]}
                  onChange={(roles) => void change(p, { roles })} />
                <Button variant={p.active ? 'secondary' : 'primary'}
                  onClick={() => void change(p, { active: !p.active })}>
                  {p.active ? 'Deaktivieren' : 'Aktivieren'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="primary" onClick={() => setInviting(true)}>Person einladen</Button>
      </div>
      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onInvited={async () => {
            setInviting(false)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [roles, setRoles] = useState<Role[]>(['staff'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await inviteStaff({ email: email.trim(), roles, display_name: name.trim() })
      await onInvited()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Person einladen"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="invite-form" disabled={busy}>
            {busy ? 'Sende …' : 'Einladung senden'}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="E-Mail">
          <TextInput type="email" required autoComplete="off" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Anzeigename">
          <TextInput value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium text-subtle">Rollen (mehrere möglich)</legend>
          <RolePicker value={roles} onChange={setRoles} />
        </fieldset>
        <p className="text-sm text-muted">
          Die eingeladene Person erhält eine E-Mail und vergibt dort ihr Passwort (mindestens 12 Zeichen).
        </p>
        <ErrorList errors={error ? [error] : []} />
      </form>
    </Dialog>
  )
}
