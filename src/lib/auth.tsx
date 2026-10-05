import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

export type Role = 'admin' | 'staff' | 'driver'

export interface Profile {
  id: string
  display_name: string
  role: Role
  active: boolean
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
        .select('id, display_name, role, active')
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
