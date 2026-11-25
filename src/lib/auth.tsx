import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

/** helper = Aushilfe (per QR freigeschaltet, nur Annahme/Rückgabe, bis Tagesende) */
export type Role = 'admin' | 'staff' | 'driver' | 'helper'

export interface Profile {
  id: string
  display_name: string
  /** abgeleitet für ältere Versionen: 'admin' oder 'staff' */
  role: 'admin' | 'staff'
  /** Rollen, beliebig kombinierbar */
  roles: Role[]
  active: boolean
  must_change_password: boolean
  /** Zugang endet (Aushilfen: Tagesende); null = unbegrenzt */
  access_until?: string | null
}

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
}

const AuthContext = createContext<AuthState>({ loading: true, session: null, profile: null })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: !!supabase, session: null, profile: null })

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let cancelled = false

    async function apply(session: Session | null) {
      if (!session) {
        if (!cancelled) setState({ loading: false, session: null, profile: null })
        return
      }
      const { data } = await client
        .from('profiles')
        .select('id, display_name, role, roles, active, must_change_password, access_until')
        .eq('id', session.user.id)
        .maybeSingle<Profile>()
      if (!cancelled) setState({ loading: false, session, profile: data ?? null })
    }

    client.auth.getSession().then(({ data }) => apply(data.session))
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      // Token-Refresh ändert das Profil nicht – unnötige Abfragen vermeiden
      if (event === 'TOKEN_REFRESHED') {
        setState((prev) => ({ ...prev, session }))
        return
      }
      void apply(session)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export const ROLE_ORDER: Role[] = ['admin', 'staff', 'driver']

/** Rollen eines Profils (ältere Profile ohne roles: aus role) */
export function profileRoles(p: Pick<Profile, 'role'> & { roles?: Role[] | null } | null | undefined): Role[] {
  if (!p) return []
  return p.roles?.length ? p.roles : [p.role]
}

export function hasRole(p: Parameters<typeof profileRoles>[0], role: Role): boolean {
  return profileRoles(p).includes(role)
}

export function isAdminProfile(p: Parameters<typeof profileRoles>[0]): boolean {
  return hasRole(p, 'admin')
}

/** Personal (staff oder admin): Zugriff auf Buchungen, Lageplan, Aufgaben */
export function isStaffProfile(p: Parameters<typeof profileRoles>[0]): boolean {
  return hasRole(p, 'admin') || hasRole(p, 'staff')
}

/** Reiner Fahrer: nur Shuttle-Ansicht */
export function isDriverOnly(p: Parameters<typeof profileRoles>[0]): boolean {
  return !!p && hasRole(p, 'driver') && !isStaffProfile(p)
}

/** Aushilfe: nur Scannen, Annahme, Rückgabe, Einchecken */
export function isHelperOnly(p: Parameters<typeof profileRoles>[0]): boolean {
  return !!p && hasRole(p, 'helper') && !isStaffProfile(p) && !hasRole(p, 'driver')
}

/** Zugang abgelaufen (access_until vorbei) */
export function accessExpired(p: Pick<Profile, 'access_until'> | null | undefined, now = new Date()): boolean {
  return !!p?.access_until && new Date(p.access_until).getTime() <= now.getTime()
}

export const ACCOUNT_ON_DEVICE = 'Auf diesem Gerät ist bereits ein Konto angemeldet. Bitte erst abmelden.'

/** Für Tageszugänge: anonym anmelden, falls noch niemand angemeldet ist. Fehlermeldung oder null. */
async function ensureAnonymousSession(): Promise<string | null> {
  if (!supabase) return 'Supabase ist nicht konfiguriert'
  const { data: current } = await supabase.auth.getSession()
  if (current.session && !current.session.user.is_anonymous) return ACCOUNT_ON_DEVICE
  if (current.session) return null
  const { error } = await supabase.auth.signInAnonymously()
  if (!error) return null
  return /anonymous/i.test(error.message) ? 'Anmeldung ohne Konto ist im System noch nicht eingeschaltet.' : error.message
}

/** QR-Freischaltung einlösen: Zugang zum ganzen Dashboard bis Tagesende. Fehlermeldung oder null. */
export async function redeemHelperCode(code: string): Promise<string | null> {
  const err = await ensureAnonymousSession()
  if (err || !supabase) return err ?? 'Supabase ist nicht konfiguriert'
  const { error } = await supabase.rpc('redeem_helper_invite', { p_code: code })
  return error ? error.message : null
}

/** Anmeldung am Scanner mit PIN und Namen (bis Tagesende). Fehlermeldung oder null. */
export async function redeemScannerPin(pin: string, name: string): Promise<string | null> {
  const err = await ensureAnonymousSession()
  if (err || !supabase) return err ?? 'Supabase ist nicht konfiguriert'
  const { data, error } = await supabase.rpc('redeem_scanner_pin', { p_pin: pin, p_name: name })
  if (error) return error.message
  const res = data as { ok: boolean; error?: string }
  return res.ok ? null : res.error ?? 'Anmeldung fehlgeschlagen'
}

/** Tageszugang (QR oder Scanner-PIN, endet um Mitternacht) statt festem Konto */
export function isDayAccess(p: Pick<Profile, 'access_until'> | null | undefined): boolean {
  return !!p?.access_until
}

export function useAuth() {
  return useContext(AuthContext)
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Supabase ist nicht konfiguriert'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) return null
  if (/confirm/i.test(error.message)) return 'E-Mail-Adresse ist noch nicht bestätigt.'
  if (/invalid/i.test(error.message)) return 'E-Mail oder Passwort falsch.'
  return error.message
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut()
}

/** Scanner-/Tageszugang abmelden: zurück zur PIN-Anmeldung statt zum Login mit E-Mail und Passwort */
export async function signOutToScanner(): Promise<void> {
  await signOut()
  window.location.replace('/scanner')
}
