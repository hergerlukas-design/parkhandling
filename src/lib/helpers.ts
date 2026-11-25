// Aushilfen per QR-Code freischalten (0.40.0): Personal erzeugt einen Einmal-Code (15 Minuten),
// die Aushilfe scannt ihn mit dem eigenen Handy und ist bis Tagesende angemeldet.
import { supabase } from './supabase'

function db() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
  return supabase
}

export interface HelperInvite {
  code: string
  expires_at: string
  access_until: string
}

export interface ActiveHelper {
  id: string
  display_name: string
  access_until: string
  invited_by: string | null
}

export async function createHelperInvite(name: string): Promise<HelperInvite> {
  const { data, error } = await db().rpc('create_helper_invite', { p_name: name })
  if (error) throw new Error(error.message)
  return data as HelperInvite
}

export async function listHelpers(): Promise<ActiveHelper[]> {
  const { data, error } = await db().rpc('list_helpers')
  if (error) throw new Error(error.message)
  return (data ?? []) as ActiveHelper[]
}

export async function revokeHelper(id: string): Promise<void> {
  const { error } = await db().rpc('revoke_helper', { p_id: id })
  if (error) throw new Error(error.message)
}

/** Link im Freischalt-QR; der Code steht hinter #, damit er nicht in Server-Logs landet */
export function helperLink(code: string, origin = window.location.origin): string {
  return `${origin}/aushilfe#${code}`
}

/** Code aus dem Link (#…) */
export function codeFromHash(hash: string): string | null {
  const code = hash.replace(/^#/, '').trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(code) ? code : null
}
