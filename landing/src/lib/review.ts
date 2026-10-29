// Review-Modus der Vorschau: Kommentare zu Abschnitten. Aktiv nur mit ?review=<REVIEW_TOKEN>.
// Das Token wird für die Sitzung im sessionStorage gehalten. Die Prüfung passiert in der Edge Function review-notes.
const STORE_KEY = 'pf-review-token'
const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-notes`
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export interface ReviewNote {
  id: string
  page: string
  section: string
  body: string
  author: string | null
  status: 'offen' | 'erledigt'
  created_at: string
}

export function getReviewToken(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('review')
    if (fromUrl) {
      sessionStorage.setItem(STORE_KEY, fromUrl)
      return fromUrl
    }
    return sessionStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
}

async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    body: JSON.stringify({ action, token: getReviewToken(), ...extra }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new Error(data.error ?? 'Die Anfrage ist fehlgeschlagen.')
  return data
}

export async function listReviewNotes(): Promise<ReviewNote[]> {
  return (await call<{ notes: ReviewNote[] }>('list')).notes
}

export async function addReviewNote(note: { page: string; section: string; body: string; author: string }): Promise<ReviewNote> {
  return (await call<{ note: ReviewNote }>('add', note)).note
}

export async function setReviewNoteStatus(id: string, status: 'offen' | 'erledigt'): Promise<void> {
  await call('status', { id, status })
}

export function rememberAuthor(name: string) {
  try {
    localStorage.setItem('pf-review-author', name)
  } catch {
    // Speicher nicht verfügbar: nicht schlimm
  }
}

export function savedAuthor(): string {
  try {
    return localStorage.getItem('pf-review-author') ?? ''
  } catch {
    return ''
  }
}
