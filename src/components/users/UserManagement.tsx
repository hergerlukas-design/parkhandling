import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, type Role } from '../../lib/auth'
import { canChangeStaff, inviteStaff, listStaff, ROLE_LABEL, updateStaff, type StaffProfile } from '../../lib/users'
import { Button, Dialog, ErrorList, Field, Select, TextInput } from '../ui'

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

  async function change(target: StaffProfile, patch: Partial<Pick<StaffProfile, 'role' | 'active'>>) {
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
              <div className="flex items-center gap-2">
                <Select aria-label="Rolle" value={p.role} className="!w-auto"
                  onChange={(e) => void change(p, { role: e.target.value as Role })}>
                  <option value="staff">{ROLE_LABEL.staff}</option>
                  <option value="admin">{ROLE_LABEL.admin}</option>
                </Select>
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
  const [role, setRole] = useState<Role>('staff')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await inviteStaff({ email: email.trim(), role, display_name: name.trim() })
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
        <Field label="Rolle">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">{ROLE_LABEL.staff}</option>
            <option value="admin">{ROLE_LABEL.admin}</option>
          </Select>
        </Field>
        <p className="text-sm text-muted">
          Die eingeladene Person erhält eine E-Mail und vergibt dort ihr Passwort (mindestens 12 Zeichen).
        </p>
        <ErrorList errors={error ? [error] : []} />
      </form>
    </Dialog>
  )
}
