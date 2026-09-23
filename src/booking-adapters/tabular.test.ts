import { describe, expect, it } from 'vitest'
import { createTabularAdapter, guessMapping, mappingProblems, parseCsv } from './tabular'

const csv = `﻿Buchungsnr;Name;Kennzeichen;Ankunft Datum;Ankunft Uhrzeit;Abholung;Parkart;Leistungen;E-Mail
B-100;"Muster; Erika";M-EM 1;24.09.2026;06:30;01.10.2026 22:15;Halle;"Innen, Laden";erika@example.com
B-101;Hans Test;HH-HT 2;25.09.2026;7:00;24.09.2026 10:00;Außen;;
`

describe('parseCsv', () => {
  it('erkennt Semikolon, Anführungszeichen und BOM', () => {
    const t = parseCsv(csv)
    expect(t.headers[0]).toBe('Buchungsnr')
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0][1]).toBe('Muster; Erika')
  })
  it('verarbeitet Komma-CSV mit maskierten Anführungszeichen und CRLF', () => {
    const t = parseCsv('a,b\r\n"x ""y""",2\r\n')
    expect(t.rows).toEqual([['x "y"', '2']])
  })
})

describe('guessMapping', () => {
  it('ordnet typische Überschriften zu', () => {
    const t = parseCsv(csv)
    const m = guessMapping(t.headers)
    expect(m).toMatchObject({
      external_ref: 0,
      customer_name: 1,
      plate: 2,
      start_date: 3,
      start_time: 4,
      end_at: 5,
      parking_type: 6,
      services: 7,
      customer_email: 8,
    })
    expect(mappingProblems(m)).toEqual([])
  })
})

describe('createTabularAdapter', () => {
  const t = parseCsv(csv)
  const adapter = createTabularAdapter({ source: 'csv', mapping: guessMapping(t.headers) })

  it('normalisiert gültige Zeilen', () => {
    const r = adapter.normalize(t.rows[0])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.booking).toMatchObject({
      external_ref: 'B-100',
      customer_name: 'Muster; Erika',
      plate: 'M-EM 1',
      start_at: '2026-09-24T04:30:00.000Z',
      end_at: '2026-10-01T20:15:00.000Z',
      parking_type: 'indoor',
      services: ['INNEN', 'LADEN'],
      customer_email: 'erika@example.com',
    })
  })

  it('meldet Fehler statt falsche Daten zu importieren', () => {
    const r = adapter.normalize(t.rows[1])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('Abholung liegt nicht nach der Ankunft')
  })
})
