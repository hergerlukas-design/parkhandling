import { execSync } from 'node:child_process'

/** Adresse und Schlüssel des lokalen Supabase-Stacks (npx supabase start). */
export interface LocalSupabase {
  url: string
  publishableKey: string
  secretKey: string
}

let cached: LocalSupabase | null = null

export function localSupabase(): LocalSupabase {
  if (cached) return cached
  if (process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_PUBLISHABLE_KEY && process.env.E2E_SUPABASE_SECRET_KEY) {
    cached = {
      url: process.env.E2E_SUPABASE_URL,
      publishableKey: process.env.E2E_SUPABASE_PUBLISHABLE_KEY,
      secretKey: process.env.E2E_SUPABASE_SECRET_KEY,
    }
    return cached
  }
  const status = JSON.parse(execSync('npx --yes supabase@2 status -o json', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>
  cached = {
    url: status.API_URL,
    publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  }
  return cached
}

export const USERS = {
  admin: { email: 'admin@e2e.test', password: 'E2E-Passwort-12345', role: 'admin', name: 'E2E Admin' },
  staff: { email: 'personal@e2e.test', password: 'E2E-Passwort-12345', role: 'staff', name: 'E2E Personal' },
} as const

export type UserKey = keyof typeof USERS

/** Aufruf der REST-API mit dem Secret Key (umgeht RLS) – nur für Testvorbereitung und Prüfungen. */
export async function adminRest(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, secretKey } = localSupabase()
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}
