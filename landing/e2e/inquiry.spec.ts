import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }

function isoInDays(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'kein horizontales Scrollen').toBeLessThanOrEqual(0)
}

test('Startseite → Anfrage → Danke (Smartphone, UTM wird mitgesendet)', async ({ page }) => {
  let sent: Record<string, unknown> | null = null
  await page.route('**/functions/v1/inquiry-submit', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, body: 'ok' })
    sent = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/?utm_source=google&utm_medium=cpc&utm_campaign=e2e-test')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sicher parken')
  await expect(page.getByText('Preis auf Anfrage').first()).toBeVisible()
  await expect(page.getByTestId('app-version')).toHaveText(`Version ${version}`)
  await expectNoHorizontalScroll(page)

  // Angebot „Halle“ wählen → Formular mit vorausgewählter Stellplatzart
  await page.getByRole('link', { name: 'Park & Fly Halle anfragen' }).click()
  await expect(page).toHaveURL(/\/anfrage\?stellplatz=indoor/)
  await expect(page.getByLabel('Halle Premium (Indoor)')).toBeChecked()
  await expectNoHorizontalScroll(page)

  // Absenden ohne Angaben zeigt Fehler
  await page.getByRole('button', { name: 'Anfrage senden' }).click()
  await expect(page.getByRole('alert')).toContainText('Bitte die markierten Felder prüfen')
  expect(sent).toBeNull()

  const arrival = isoInDays(3)
  const pickup = isoInDays(10)
  await page.getByLabel('Anreise').fill(arrival)
  await page.getByLabel('Abholung').fill(pickup)
  await expect(page.getByTestId('duration')).toContainText('7 Tage')
  await page.getByLabel('Kennzeichen').fill('M-TE 123')
  await page.getByLabel('Vorname').fill('Test')
  await page.getByLabel('Nachname').fill('Person')
  await page.getByLabel('E-Mail').fill('test.person@example.com')
  await page.getByLabel('Shuttle zum Terminal').check()
  await page.getByLabel('Fahrzeugaufbereitung').check()
  await page.getByLabel(/Datenschutzhinweis/).check()
  await expectNoHorizontalScroll(page)

  // Touch-Ziele mindestens 44 px
  for (const name of ['Anfrage senden']) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  const inputBox = await page.getByLabel('Kennzeichen').boundingBox()
  expect(inputBox!.height).toBeGreaterThanOrEqual(44)

  await page.getByRole('button', { name: 'Anfrage senden' }).click()
  await expect(page).toHaveURL(/\/danke$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vielen Dank für Ihre Anfrage!')
  await expect(page.getByText('test.person@example.com')).toBeVisible()
  await expectNoHorizontalScroll(page)

  expect(sent).toMatchObject({
    arrival_date: arrival,
    pickup_date: pickup,
    parking_type: 'indoor',
    plate: 'M-TE 123',
    email: 'test.person@example.com',
    services: ['shuttle', 'detailing'],
    consent_privacy: true,
    website: '',
    utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'e2e-test' },
  })
  expect(sent!.form_duration_ms).toEqual(expect.any(Number))
})

test('Serverfehler (Rate-Limit) wird verständlich angezeigt', async ({ page }) => {
  await page.route('**/functions/v1/inquiry-submit', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 200, body: 'ok' })
      : route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Zu viele Anfragen.' }) }),
  )
  await page.goto('/anfrage?stellplatz=any')
  await page.getByLabel('Anreise').fill(isoInDays(1))
  await page.getByLabel('Abholung').fill(isoInDays(2))
  await page.getByLabel('Kennzeichen').fill('M-TE 1')
  await page.getByLabel('Vorname').fill('Test')
  await page.getByLabel('Nachname').fill('Person')
  await page.getByLabel('E-Mail').fill('test@example.com')
  await page.getByLabel(/Datenschutzhinweis/).check()
  await page.getByRole('button', { name: 'Anfrage senden' }).click()
  await expect(page.getByRole('alert')).toContainText('Zu viele Anfragen')
  await expect(page).toHaveURL(/\/anfrage/)
})

test('Impressum und Datenschutz sind Platzhalter, Seite ist noindex', async ({ page }) => {
  await page.goto('/impressum')
  await expect(page.getByText('Diese Seite wird vor Go-live ergänzt.')).toBeVisible()
  await page.goto('/datenschutz')
  await expect(page.getByText('Diese Seite wird vor Go-live ergänzt.')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})
