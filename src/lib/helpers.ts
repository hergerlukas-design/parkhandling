// Tageszugänge (0.41.0):
//  * QR-Freischaltung: Personal erzeugt einen Einmal-Code (15 Minuten), wer ihn mit dem eigenen Handy
//    scannt, hat bis Tagesende Zugang zum ganzen Dashboard
//  * Scanner: /scanner mit gemeinsamer 4-stelliger PIN (setzen nur Admins) und Namen, bis Tagesende
//    nur Scannen, Annahme, Einparken, Rückgabe
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
  /** dashboard = per QR (ganzes Dashboard), scanner = per PIN (nur Scanner) */
  kind: 'dashboard' | 'scanner'
}

export interface ScannerPinStatus {
  is_set: boolean
  updated_at: string | null
  updated_by: string | null
  failed_last_hour: number
}

export async function scannerPinStatus(): Promise<ScannerPinStatus> {
  const { data, error } = await db().rpc('scanner_pin_status')
  if (error) throw new Error(error.message)
  return data as ScannerPinStatus
}

export async function setScannerPin(pin: string): Promise<ScannerPinStatus> {
  const { data, error } = await db().rpc('set_scanner_pin', { p_pin: pin })
  if (error) throw new Error(error.message)
  return data as ScannerPinStatus
}

/** Gültige Scanner-PIN: genau 4 Ziffern */
export function validPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/** Adresse des Scanner-Zugangs */
export function scannerLink(origin = window.location.origin): string {
  return `${origin}/scanner`
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
