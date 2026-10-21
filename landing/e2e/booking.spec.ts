import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }

const TARIFFS = [
  { code: 'economy', label: 'Economy', parking_type: 'outdoor', shuttle_text: 'Alle 60 Minuten', included_text: 'Außenstellplatz 12 m², abgesperrtes Gelände', price_week: 89, price_holiday: 129, price_month: 179 },
  { code: 'space', label: 'Space', parking_type: 'outdoor_cover', shuttle_text: 'Alle 60 Minuten', included_text: 'Außenstellplatz 15 m²', price_week: 95, price_holiday: 138, price_month: 199 },
  { code: 'business', label: 'Business', parking_type: 'indoor', shuttle_text: 'Alle 30 Minuten', included_text: 'Innenstellplatz im Park-Regal', price_week: 125, price_holiday: 195, price_month: 299 },
  { code: 'premium', label: 'Premium', parking_type: 'indoor', shuttle_text: 'Direkt', included_text: 'Innenstellplatz im Park-Regal, CarCover Satin Indoor', price_week: 148, price_holiday: 249, price_month: 369 },
]

function isoInDays(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'kein horizontales Scrollen').toBeLessThanOrEqual(0)
}

test.beforeEach(async ({ page }) => {
  // PayPal-SDK und Zahlung im Test nicht laden
  await page.route('**/paypal.com/**', (route) => route.abort())
  await page.route('**/functions/v1/booking-checkout', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, body: 'ok' })
    const body = route.request().postDataJSON() as { action?: string }
    if (body.action === 'tariffs')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tariffs: TARIFFS }) })
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'nicht im Test' }) })
  })
})

test('Startseite zeigt Tarife und führt mit Vorauswahl zur Buchung (Smartphone)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sicher parken')
  await expect(page.getByRole('heading', { name: 'Premium' })).toBeVisible()
  await expect(page.getByTestId('app-version')).toHaveText(`Version ${version}`)
  await expectNoHorizontalScroll(page)

  await page.getByRole('link', { name: 'Premium buchen' }).click()
  await expect(page).toHaveURL(/\/anfrage\?tarif=premium/)
  await expect(page.getByLabel('Premium')).toBeChecked()
  await expectNoHorizontalScroll(page)
})

test('Dauer und Preis werden aus dem Zeitraum berechnet', async ({ page }) => {
  await page.goto('/anfrage?tarif=premium')
  await page.getByLabel('Anreise', { exact: true }).fill(isoInDays(3))
  await page.getByLabel('Abholung', { exact: true }).fill(isoInDays(10))
  await expect(page.getByTestId('duration')).toContainText('7 Tage')
  await expect(page.getByTestId('total')).toContainText('148,00')

  // 12 Tage → Ferienpreis
  await page.getByLabel('Abholung', { exact: true }).fill(isoInDays(15))
  await expect(page.getByTestId('total')).toContainText('249,00')

  // 17 Tage → Monatspreis
  await page.getByLabel('Abholung', { exact: true }).fill(isoInDays(20))
  await expect(page.getByTestId('total')).toContainText('369,00')
})

test('Zu kurze Dauer wird sofort erklärt', async ({ page }) => {
  await page.goto('/anfrage')
  await page.getByLabel('Anreise', { exact: true }).fill(isoInDays(3))
  await page.getByLabel('Abholung', { exact: true }).fill(isoInDays(5))
  await expect(page.getByText('Online buchbar ab 5 Tagen')).toBeVisible()
})

test('Zahlung ist ohne PayPal-Skript als Hinweis sichtbar und die Seite bleibt bedienbar', async ({ page }) => {
  await page.goto('/anfrage?tarif=economy')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jetzt buchen')
  await expect(page.getByTestId('paypal-area')).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('Impressum und Datenschutz sind Platzhalter, Seite ist noindex', async ({ page }) => {
  await page.goto('/impressum')
  await expect(page.getByText('Diese Seite wird vor Go-live ergänzt.')).toBeVisible()
  await page.goto('/datenschutz')
  await expect(page.getByText('Diese Seite wird vor Go-live ergänzt.')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('AGB und Widerrufsbelehrung sind vollständig, interne Freigabe-Hinweise fehlen', async ({ page }) => {
  await page.goto('/agb')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Allgemeine Geschäftsbedingungen')
  await expect(page.getByText('Stand: 2026-10')).toBeVisible()
  await expect(page.getByRole('heading', { name: '13 Schlussbestimmungen' })).toBeVisible()
  await expect(page.getByText('Zusatzleistungen und Umsetzung')).toHaveCount(0)
  await expect(page.getByText('Betriebsmodell')).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await page.goto('/widerruf')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Widerrufsbelehrung')
  await expect(page.getByRole('heading', { name: 'Muster Widerrufsformular' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('Zustimmungen sind Pflicht, die Zusatz-Zustimmung erscheint nur bei Anreise innerhalb von 14 Tagen', async ({ page }) => {
  await page.goto('/anfrage?tarif=premium')
  await expect(page.locator('#consent_agb')).not.toBeChecked()
  await expect(page.locator('#consent_withdrawal')).not.toBeChecked()
  await page.getByLabel('Anreise', { exact: true }).fill(isoInDays(40))
  await page.getByLabel('Abholung', { exact: true }).fill(isoInDays(45))
  await expect(page.locator('#consent_early_start')).toHaveCount(0)

  await page.getByLabel('Anreise', { exact: true }).fill(isoInDays(3))
  await page.getByLabel('Abholung', { exact: true }).fill(isoInDays(10))
  await expect(page.locator('#consent_early_start')).toBeVisible()
  await expect(page.locator('#consent_early_start')).not.toBeChecked()
})

test('Shuttle verlangt Flugnummern, bei Selbst-Rückgabe entfallen sie', async ({ page }) => {
  await page.goto('/anfrage?tarif=premium')
  await expect(page.getByLabel('Flugnummer Hinflug')).toBeVisible()
  await expect(page.getByLabel('Flugnummer Rückflug')).toBeVisible()
  await expect(page.getByLabel('Kindersitze')).toBeVisible()
  await expect(page.getByLabel('Gepäckstücke')).toBeVisible()
  await page.locator('select[name="return_mode"]').selectOption('self')
  await expect(page.getByLabel('Flugnummer Hinflug')).toHaveCount(0)
  await expectNoHorizontalScroll(page)
})

test('Online-Widerruf: Eingang wird mit Zeitpunkt bestätigt', async ({ page }) => {
  await page.route('**/functions/v1/booking-checkout', (route) => {
    const body = route.request().postDataJSON() as { action?: string }
    if (body.action === 'withdraw')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ booking_ref: 'PF-1A2B3C4D', received_at: '2026-10-20T16:05:00.000Z' }),
      })
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/widerruf')
  await page.getByLabel('Buchungsnummer').fill('pf-1a2b3c4d')
  await page.getByLabel('E-Mail der Buchung').fill('max@example.de')
  await page.getByLabel('Vor- und Nachname').fill('Max Muster')
  await page.getByRole('button', { name: 'Widerruf absenden' }).click()
  await expect(page.getByText('Ihr Widerruf ist eingegangen')).toBeVisible()
  await expect(page.getByText('20.10.2026, 18:05 Uhr')).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('Online-Widerruf: ohne Bestätigung und bei unbekannter Buchung wird es erklärt', async ({ page }) => {
  await page.route('**/functions/v1/booking-checkout', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Zu dieser Buchungsnummer und E-Mail-Adresse finden wir keine Buchung. Bitte prüfen Sie die Angaben.' }),
    }),
  )
  await page.goto('/widerruf')
  await page.getByLabel('Buchungsnummer').fill('PF-1A2B3C4D')
  await page.getByLabel('E-Mail der Buchung').fill('max@example.de')
  await page.getByLabel('Vor- und Nachname').fill('Max Muster')
  await page.getByRole('button', { name: 'Widerruf absenden' }).click()
  await expect(page.getByText('keine Buchung')).toBeVisible()
})

test('Review-Modus: Kommentare nur mit Token sichtbar, Abschnitte sind markiert', async ({ page }) => {
  await page.route('**/functions/v1/review-notes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notes: [] }) }),
  )
  await page.goto('/anfrage')
  await expect(page.getByRole('button', { name: /^Kommentare/ })).toHaveCount(0)
  await expect(page.locator('[data-review="tarif"]')).toHaveCount(1)

  await page.goto('/anfrage?review=test-token')
  await expect(page.getByRole('button', { name: /^Kommentare/ })).toBeVisible()
  await page.getByRole('button', { name: /^Kommentare/ }).click()
  await expect(page.getByRole('button', { name: 'Neuer Kommentar' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})
