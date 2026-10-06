import type { MediaProvider } from '../../types/domain'
import { supabase } from '../supabase'
import { createSupabaseMediaStore } from './supabaseStore'
import type { MediaStore } from './types'

export type { MediaRef, MediaStore, UploadRequest, UploadTicket, UploadTarget } from './types'

const stores = new Map<MediaProvider, MediaStore>()

/**
 * Liefert die MediaStore-Implementierung für einen Provider. Neue Uploads gehen an
 * DEFAULT_PROVIDER; bestehende Dateien werden über ihren gespeicherten provider gelesen.
 */
export const DEFAULT_PROVIDER: MediaProvider = 'supabase'

export function getMediaStore(provider: MediaProvider = DEFAULT_PROVIDER): MediaStore {
  const existing = stores.get(provider)
  if (existing) return existing
  let store: MediaStore
  switch (provider) {
    case 'supabase':
      if (!supabase) throw new Error('Supabase ist nicht konfiguriert')
      store = createSupabaseMediaStore(supabase, import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
      break
    case 'r2':
      throw new Error('R2-Speicher ist noch nicht eingerichtet')
  }
  stores.set(provider, store)
  return store
}
