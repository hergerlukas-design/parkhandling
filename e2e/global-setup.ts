import { USERS, adminRest } from './supabase'

/** Legt die Testkonten an bzw. setzt ihr Passwort zurück und schaltet sie frei (idempotent). */
export default async function globalSetup() {
  for (const u of Object.values(USERS)) {
    const res = await adminRest('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true, user_metadata: { name: u.name } }),
    })
    if (res.status === 422) {
      const found = await adminRest(`/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(u.email)}`)
      const [{ id }] = (await found.json()) as { id: string }[]
      const reset = await adminRest(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ password: u.password }) })
      if (!reset.ok) throw new Error(`Passwort ${u.email}: HTTP ${reset.status} ${await reset.text()}`)
    } else if (!res.ok) {
      throw new Error(`Testkonto ${u.email}: HTTP ${res.status} ${await res.text()}`)
    }
    const upd = await adminRest(`/rest/v1/profiles?email=eq.${encodeURIComponent(u.email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: true, role: u.role, display_name: u.name, must_change_password: false }),
    })
    if (!upd.ok) throw new Error(`Profil ${u.email}: HTTP ${upd.status} ${await upd.text()}`)
  }
}
