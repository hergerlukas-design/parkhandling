import { adminRest } from './supabase'
import { expect, login, test } from './fixtures'

test('Personal sieht keine Admin-Bereiche @mobil', async ({ page, problems }) => {
  void problems
  await login(page, 'staff')
  await page.goto('/einstellungen')
  await expect(page.getByText('Angemeldet als')).toBeVisible()
  await expect(page.getByText('Aufbewahrung: Fotos')).toHaveCount(0)
  await expect(page.getByText('Fehlerprotokoll')).toHaveCount(0)
})

test('Admin schaltet den Foto-Lösch-Job ein und wieder aus', async ({ page, problems }) => {
  void problems
  await login(page, 'admin')
  await page.goto('/einstellungen')
  const card = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Aufbewahrung: Fotos' }) }).last()
  await expect(card.getByText(/Täglicher Lösch-Job/)).toContainText('aus')
  await expect(card.getByText(/Jetzt fällig/)).toBeVisible()

  await card.getByRole('button', { name: 'Einschalten' }).click()
  await expect(card.getByText('Lösch-Job eingeschaltet, läuft ab heute Nacht.')).toBeVisible()
  await expect(card.getByText(/Täglicher Lösch-Job/)).toContainText('an')

  await card.getByRole('button', { name: 'Ausschalten' }).click()
  await expect(card.getByText(/Täglicher Lösch-Job/)).toContainText('aus')

  const res = await adminRest('/rest/v1/settings?select=value&key=eq.media_retention_job_enabled')
  expect(await res.json()).toEqual([{ value: false }])
})

test('Fehler in der App landen im Fehlerprotokoll', async ({ page }) => {
  // Absichtlich ausgelöster Fehler: hier keine problems-Fixture, sie würde ihn als Testfehler werten
  await login(page, 'staff')
  // Nur Buchstaben: Ziffern ignoriert der Fingerabdruck, sonst zählte der Server den Fehler zu einem früheren Lauf
  const marker = `E2E-Testfehler ${Math.random().toString(36).replace(/[^a-z]/g, '')}`
  await page.evaluate((m) => setTimeout(() => { throw new Error(m) }), marker)
  await expect.poll(async () => {
    const res = await adminRest(`/rest/v1/client_errors?select=message,route,user_id&message=like.*${encodeURIComponent(marker)}*`)
    return (await res.json()) as unknown[]
  }).toHaveLength(1)

  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await login(page, 'admin')
  await page.goto('/einstellungen')
  await expect(page.getByText(`Error: ${marker}`)).toBeVisible()
})
