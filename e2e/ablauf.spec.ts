import type { Page } from '@playwright/test'
import { expect, login, test } from './fixtures'

/** Einmal von der Buchung bis zur Übergabe – der Kernablauf des Betriebs. */

/** Kleines, gültiges PNG (64×48, einfarbig) als Testfoto */
function testImage(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZElEQVR4nO3PUQkAIBTAwBfHiEY0liH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY8dgGIweDx+vacjQAAAABJRU5ErkJggg==',
    'base64',
  )
}

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

async function sign(page: Page, button: string) {
  await page.getByRole('button', { name: button, exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  const pad = dialog.locator('canvas')
  const box = (await pad.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 20 + i * 25, box.y + box.height / 2 + (i % 2 ? 20 : -20))
  await page.mouse.up()
  await dialog.getByRole('button', { name: 'Unterschrift übernehmen' }).click()
  await expect(dialog).toHaveCount(0)
}

test('Buchung anlegen, Annahme, Einchecken, Auschecken und Übergabe', async ({ page, problems }) => {
  void problems
  const plate = `M-E2E ${Date.now() % 10000}`
  await login(page, 'staff')

  // Buchung anlegen
  await page.getByRole('link', { name: 'Fahrzeuge' }).first().click()
  await page.getByRole('button', { name: /Buchung anlegen/ }).click()
  const form = page.getByRole('dialog', { name: 'Neue Buchung' })
  await form.getByLabel('Kunde *').fill('Erika E2E')
  await form.getByLabel('Kennzeichen *').fill(plate)
  await form.getByLabel('Antrieb').selectOption({ label: 'Verbrenner' })
  await form.getByLabel('Anreise *').fill(isoDate(0))
  await form.getByLabel('Abholung *').fill(isoDate(7))
  await form.getByRole('button', { name: 'Anlegen' }).click()
  await expect(page.getByRole('heading', { name: plate })).toBeVisible()

  // Annahmeprotokoll
  await page.getByRole('link', { name: /Annahme/ }).click()
  await page.getByLabel('Mitarbeiter').fill('E2E Personal')
  await page.getByLabel(/Kilometerstand/).fill('12345,5')
  await page.getByLabel('Tankstand in Segmenten').fill('6')
  // Foto „Vorne“: wird im Worker verkleinert, hochgeladen und als Vorschaubild angezeigt
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Foto', exact: true }).first().click()
  await (await chooser).setFiles({ name: 'vorne.png', mimeType: 'image/png', buffer: testImage() })
  await expect(page.getByRole('button', { name: /vergrößern/ }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /vergrößern/ }).first().click()
  await expect(page.locator('[role=dialog] img')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel('Name Kunde').fill('Erika E2E')
  await sign(page, 'Unterschreiben')
  await expect(page.getByRole('button', { name: 'Neu unterschreiben' })).toHaveCount(1)
  await sign(page, 'Unterschreiben')
  await expect(page.getByRole('button', { name: 'Neu unterschreiben' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Abschließen & PDF senden' }).click()
  await expect(page.getByText(/abgeschlossen/i).first()).toBeVisible({ timeout: 30_000 })
  // Unterschriften und PDF sind hochgeladen
  await expect(page.getByRole('button', { name: /Lädt hoch/ })).toHaveCount(0, { timeout: 30_000 })

  // Einchecken auf dem empfohlenen Platz
  await page.getByRole('button', { name: /Einchecken auf|Weiter zum Einchecken/ }).click()
  await page.getByRole('button', { name: /bestätigen$/ }).click()
  await expect(page.getByRole('heading', { name: `${plate} eingecheckt` })).toBeVisible()
  await page.getByRole('button', { name: 'Zum Fahrzeug' }).click()

  // Auschecken in die Übergabezone, dann Übergabeprotokoll
  await page.getByRole('button', { name: 'Auschecken' }).click()
  const move = page.getByRole('dialog', { name: /Auschecken/ })
  await move.getByRole('button', { name: /Übergabezone/ }).click()
  await move.getByRole('button', { name: 'Nach W-UEB' }).click()
  await page.getByRole('button', { name: 'Übergabeprotokoll erstellen' }).click()
  await expect(page.getByRole('heading', { name: `Übergabeprotokoll ${plate}` })).toBeVisible()
  await page.getByLabel('Mitarbeiter').fill('E2E Personal')
  await page.getByLabel('Tankstand in Segmenten').fill('5')
  await page.getByLabel('Name Kunde').fill('Erika E2E')
  await sign(page, 'Unterschreiben')
  await expect(page.getByRole('button', { name: 'Neu unterschreiben' })).toHaveCount(1)
  await sign(page, 'Unterschreiben')
  await expect(page.getByRole('button', { name: 'Neu unterschreiben' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Abschließen & Fahrzeug übergeben' }).click()
  await expect(page.getByText(/übergeben/i).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /Lädt hoch/ })).toHaveCount(0, { timeout: 30_000 })

  // Buchung ist abgeschlossen
  await page.getByRole('button', { name: 'Zum Fahrzeug' }).click()
  await expect(page.getByText('Abgeschlossen', { exact: false }).first()).toBeVisible()
})
