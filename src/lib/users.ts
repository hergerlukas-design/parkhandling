import { ROLE_ORDER, type Role } from './auth'
import { supabase } from './supabase'

export const MIN_PASSWORD_LENGTH = 12

export interface StaffProfile {
  id: string
  email: string | null
  display_name: string
  role: 'admin' | 'staff'
  roles: Role[]
  active: boolean
  invited_at: string | null
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', staff: 'Personal', driver: 'Fahrer' }

/** Rollen sortiert und ohne Doppelte; mindestens eine */
export function normalizeRoles(roles: readonly Role[]): Role[] {
  return ROLE_ORDER.filter((r) => roles.includes(r))
}

/** Rolle an- oder abwählen; die letzte Rolle bleibt stehen */
export function toggleRole(roles: readonly Role[], role: Role, on: boolean): Role[] {
  const next = normalizeRoles(on ? [...roles, role] : roles.filter((r) => r !== role))
  return next.length ? next : normalizeRoles(roles)
}

export function rolesLabel(roles: readonly Role[]): string {
  return normalizeRoles(roles).map((r) => ROLE_LABEL[r]).join(', ') || ROLE_LABEL.staff
}

/** Alle Profile (nur für Admins sichtbar, RLS). */
export async function listStaff(): Promise<StaffProfile[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, role, roles, active, invited_at')
    .order('display_name')
  if (error) throw new Error('Personal konnte nicht geladen werden')
  return (data ?? []) as StaffProfile[]
}

export async function updateStaff(id: string, patch: Partial<Pick<StaffProfile, 'roles' | 'active'>>): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  if (error) throw new Error(error.message.includes('letzte aktive Admin') ? error.message : 'Änderung fehlgeschlagen')
}

export async function inviteStaff(input: { email: string; roles: Role[]; display_name: string }): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  const roles = normalizeRoles(input.roles)
  // role für ältere Fassungen der Edge Function, roles für die aktuelle
  const body = { email: input.email, display_name: input.display_name, roles, role: roles.includes('admin') ? 'admin' : 'staff' }
  const { data, error } = await supabase.functions.invoke<{ error?: string; id?: string }>('user-invite', { body })
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
  // Fahrer-Rolle kennt eine ältere Edge Function nicht → Rollen danach setzen
  if (data?.id) await updateStaff(data.id, { roles })
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

/** Fehlermeldung von Supabase für den Passwort-Link übersetzen. */
export function resetErrorMessage(message: string): string {
  if (/rate limit|security purposes|seconds/i.test(message)) {
    return 'Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.'
  }
  return 'Link konnte nicht gesendet werden'
}

/**
 * Link zum Zurücksetzen des Passworts per E-Mail (Passwort vergessen, auch vom Admin ausgelöst).
 * Der Link führt auf /passwort; dort greift dieselbe Seite wie nach der Einladung.
 */
export async function requestPasswordReset(email: string): Promise<string | null> {
  if (!supabase) return 'Supabase ist nicht konfiguriert'
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/passwort`,
  })
  return error ? resetErrorMessage(error.message) : null
}

/** Clientseitige Vorprüfung; die verbindliche Prüfung liegt in der Datenbank (Trigger guard_last_admin). */
export function canChangeStaff(
  target: Pick<StaffProfile, 'id' | 'roles' | 'active'>,
  patch: Partial<Pick<StaffProfile, 'roles' | 'active'>>,
  all: Pick<StaffProfile, 'id' | 'roles' | 'active'>[],
): string | null {
  const removesAdmin = target.roles.includes('admin') && target.active &&
    ((patch.roles !== undefined && !patch.roles.includes('admin')) || patch.active === false)
  if (!removesAdmin) return null
  const otherActiveAdmins = all.some((p) => p.id !== target.id && p.roles.includes('admin') && p.active)
  return otherActiveAdmins ? null : 'Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden.'
}
