/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs'
import readXlsxFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import type { CellValue } from './parse'
import { createTabularAdapter, guessMapping, PLATE_CHECK_NOTE, TEMPLATE_SHEET, toTable } from './tabular'

// Testdatei im Format der Vorlage „ParkHandling_Buchungsliste“ (Titelzeile, Leerzeile, Kopfzeile, 5 Zeilen)
const FILE = new URL('../../docs/testdaten/Buchungsliste_Test_5_Zeilen.xlsx', import.meta.url)

describe('Excel-Vorlage mit 5 Testzeilen', async () => {
  const sheets = await readXlsxFile(readFileSync(FILE))
  const sheet = sheets.find((s) => s.sheet === TEMPLATE_SHEET)!
  const table = toTable(sheet.data as CellValue[][], sheet.sheet)
  const adapter = createTabularAdapter({ source: 'excel', mapping: guessMapping(table.headers) })
  const results = table.rows.map((r) => adapter.normalize(r))
  const ok = results.flatMap((r) => (r.ok ? [r.booking] : []))

  it('liest das Blatt „Buchungseingänge“ und alle 5 Zeilen', () => {
    expect(table.headers).toHaveLength(18)
    expect(table.rows).toHaveLength(5)
    expect(results.every((r) => r.ok)).toBe(true)
  })

  it('übernimmt Excel-Datumswerte als Berliner Ortszeit', () => {
    expect(ok[0].start_at).toBe('2026-10-12T04:30:00.000Z')
    expect(ok[0].end_at).toBe('2026-10-18T19:00:00.000Z')
    // Gleitkomma-Ungenauigkeit von Excel (07:00 → 06:59:59.999) wird auf Minuten gerundet
    expect(ok[1].start_at).toBe('2026-10-12T05:00:00.000Z')
    expect(ok[0].received_at).toBe('2026-10-05T07:15:00.000Z')
  })

  it('verarbeitet Leistung, Parkplatz, Preis, Zahlung und Storno', () => {
    expect(ok[0]).toMatchObject({ plate: 'M-TE 1001E', vehicle_model: 'Tesla Model 3', parking_type: 'indoor', price_total: 249, payment_status: 'paid' })
    expect(ok[1]).toMatchObject({ plate: 'M-TE 1002', company: 'Muster Logistik GmbH', parking_type: 'outdoor_cover', price_total: 119.5 })
    expect(ok[2]).toMatchObject({ plate: 'M-TE 1003', vehicle_model: 'BMW 320d', return_mode: 'pickup_delivery', payment_status: 'partial', price_total: 89 })
    expect(ok[3]).toMatchObject({ return_mode: 'vallet', services: ['AUF_INNEN', 'AUF_AUSSEN', 'POLITUR'] })
    expect(ok[3].notes).toContain(PLATE_CHECK_NOTE)
    expect(ok[4]).toMatchObject({ cancelled: true, payment_status: 'refunded' })
  })

  it('stellt die normalisierten Daten für den Live-Test bereit', () => {
    if (process.env.PF_EXPORT_IMPORT_JSON) writeFileSync(process.env.PF_EXPORT_IMPORT_JSON, JSON.stringify(ok))
    expect(ok).toHaveLength(5)
  })
})
