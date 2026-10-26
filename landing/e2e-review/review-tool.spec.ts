import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const dir = process.env.REVIEW_DIR!
const readJson = () => JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf-8'))
const readMd = () => readFileSync(join(dir, 'NOTES.md'), 'utf-8')

test('Stift, Text und Element markieren, Notizen landen in NOTES.md', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Markieren/ }).click()

  // 1) Stift: Kreis um die Hero-Überschrift zeichnen
  await page.getByRole('button', { name: '✎ Stift' }).click()
  const h1 = await page.locator('h1').boundingBox()
  const cx = h1!.x + h1!.width / 2
  const cy = h1!.y + h1!.height / 2
  await page.mouse.move(cx + h1!.width / 2, cy)
  await page.mouse.down()
  for (let a = 0; a <= 2 * Math.PI + 0.3; a += 0.3)
    await page.mouse.move(cx + (Math.cos(a) * h1!.width) / 2, cy + (Math.sin(a) * h1!.height) / 1.5)
  await page.mouse.up()
  await page.getByPlaceholder('Was soll hier geändert werden?').fill('Überschrift kürzer formulieren')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('button', { name: /Markieren|Liste \(1\)/ }).first()).toBeVisible()
  await expect.poll(() => readJson().marks.length).toBe(1)
  const pen = readJson().marks[0]
  expect(pen).toMatchObject({ nr: 1, page: '/', kind: 'pen', note: 'Überschrift kürzer formulieren', status: 'offen' })
  expect(pen.strokes[0].length).toBeGreaterThan(10)
  expect(pen.context.elements.map((e: { tag: string }) => e.tag)).toContain('h1')
  expect(pen.context.section).toBe('Startseite: Hero')

  // 2) Text: Wort in einem Absatz markieren
  await page.getByRole('button', { name: '▤ Text' }).click()
  const para = page.getByText('Der Preis richtet sich nach der Dauer Ihrer Reise.')
  const pb = await para.boundingBox()
  await page.mouse.move(pb!.x + 2, pb!.y + pb!.height / 2)
  await page.mouse.down()
  await page.mouse.move(pb!.x + Math.min(160, pb!.width - 4), pb!.y + pb!.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.getByPlaceholder('Was soll hier geändert werden?').fill('Text prüfen')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => readJson().marks.length).toBe(2)
  expect(readJson().marks[1].quote.length).toBeGreaterThan(3)

  // 3) Element: Klick wird abgefangen (keine Navigation), Element wird erfasst
  await page.getByRole('button', { name: '⬚ Element' }).click()
  await page.locator('header a').last().click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByPlaceholder('Was soll hier geändert werden?').fill('Button-Farbe ändern')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => readJson().marks.length).toBe(3)
  expect(readJson().marks[2]).toMatchObject({ kind: 'element', context: { elements: [{ tag: 'a' }] } })

  // Markdown für Claude Code
  const md = readMd()
  expect(md).toContain('3 offen · 0 erledigt')
  expect(md).toContain('### #1 · `/` · Stift')
  expect(md).toContain('**Notiz:** Button-Farbe ändern')

  // Liste: als erledigt markieren
  await page.getByRole('button', { name: /^Liste/ }).click()
  await page.getByRole('button', { name: 'Erledigt' }).first().click()
  await expect.poll(() => readMd()).toContain('2 offen · 1 erledigt')

  // Nach Neuladen sind Markierungen wieder da (Nummern-Abzeichen)
  await page.reload()
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1', exact: true })).toHaveCount(0)

  // Screenshots offener Markierungen (Playwright im Dev-Server)
  await expect.poll(() => existsSync(join(dir, 'screens', '2.png')), { timeout: 30_000 }).toBe(true)
  await expect.poll(() => readMd(), { timeout: 10_000 }).toContain('![Markierung #3](screens/3.png)')
  expect(existsSync(join(dir, 'screens', '1.png'))).toBe(false)
})
