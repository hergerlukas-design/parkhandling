import { expect, login, test } from './fixtures'

test('falsches Passwort wird abgewiesen @mobil', async ({ page, problems }) => {
  void problems
  await page.goto('/')
  await page.getByLabel('E-Mail').fill('admin@e2e.test')
  await page.getByLabel('Passwort').fill('falsch-falsch-falsch')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByText(/falsch|ungültig|fehlgeschlagen/i)).toBeVisible()
})

test('Personal meldet sich an und sieht die Tagesübersicht @mobil', async ({ page, problems }) => {
  void problems
  await login(page, 'staff')
  await expect(page.getByText('Ankünfte', { exact: false }).first()).toBeVisible()
})
