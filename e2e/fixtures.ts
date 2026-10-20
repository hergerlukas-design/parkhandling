import { expect, test as base, type Page } from '@playwright/test'
import { USERS, type UserKey } from './supabase'

/**
 * Jede Seite sammelt Verstöße gegen die CSP und unbehandelte Fehler; ein Test schlägt fehl,
 * wenn am Ende welche aufgetreten sind.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: async ({ page }, use) => {
    const problems: string[] = []
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) =>
        console.error(`CSP-Verstoß: ${e.violatedDirective} ${e.blockedURI}`),
      )
    })
    page.on('console', (m) => {
      if (m.text().startsWith('CSP-Verstoß') || /Content Security Policy/i.test(m.text())) problems.push(m.text())
    })
    page.on('pageerror', (e) => problems.push(`Fehler: ${e.message}`))
    await use(problems)
    expect(problems, 'CSP-Verstöße oder unbehandelte Fehler').toEqual([])
  },
})

export { expect }

export async function login(page: Page, who: UserKey) {
  const u = USERS[who]
  await page.goto('/')
  await page.getByLabel('E-Mail').fill(u.email)
  await page.getByLabel('Passwort').fill(u.password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('button', { name: 'Anmelden' })).toHaveCount(0)
}
