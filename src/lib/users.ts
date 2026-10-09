import type { Role } from './auth'
import { supabase } from './supabase'

export const MIN_PASSWORD_LENGTH = 12

export interface StaffProfile {
  id: string
  email: string | null
  display_name: string
  role: Role
  active: boolean
  invited_at: string | null
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', staff: 'Personal' }

/** Alle Profile (nur für Admins sichtbar, RLS). */
export async function listStaff(): Promise<StaffProfile[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, role, active, invited_at')
    .order('display_name')
  if (error) throw new Error('Personal konnte nicht geladen werden')
  return (data ?? []) as StaffProfile[]
}

export async function updateStaff(id: string, patch: Partial<Pick<StaffProfile, 'role' | 'active'>>): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  if (error) throw new Error(error.message.includes('letzte aktive Admin') ? error.message : 'Änderung fehlgeschlagen')
}

export async function inviteStaff(input: { email: string; role: Role; display_name: string }): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  const { data, error } = await supabase.functions.invoke<{ error?: string }>('user-invite', { body: input })
  if (error || data?.error) {
    const context = (error as { context?: Response } | null)?.context
    let message = data?.error ?? 'Einladung fehlgeschlagen'
    if (!data?.error && context) {
      try {
        message = ((await context.json()) as { error?: string }).error ?? message
      } catch {
        /* Standardmeldung behalten */
      }
    }
    throw new Error(message)
  }
}

/** Passwort setzen nach Einladung (Session kommt aus dem Einladungslink). */
export async function setPassword(password: string): Promise<string | null> {
  if (!supabase) return 'Supabase ist nicht konfiguriert'
  if (password.length < MIN_PASSWORD_LENGTH) return `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return 'Passwort konnte nicht gespeichert werden'
  const { error: flagError } = await supabase.rpc('complete_password_change')
  return flagError ? 'Passwort gespeichert, Profil konnte nicht aktualisiert werden' : null
}

/** Clientseitige Vorprüfung; die verbindliche Prüfung liegt in der Datenbank (Trigger guard_last_admin). */
export function canChangeStaff(
  target: Pick<StaffProfile, 'id' | 'role' | 'active'>,
  patch: Partial<Pick<StaffProfile, 'role' | 'active'>>,
  all: StaffProfile[],
): string | null {
  const removesAdmin = target.role === 'admin' && target.active &&
    ((patch.role !== undefined && patch.role !== 'admin') || patch.active === false)
  if (!removesAdmin) return null
  const otherActiveAdmins = all.some((p) => p.id !== target.id && p.role === 'admin' && p.active)
  return otherActiveAdmins ? null : 'Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden.'
}
