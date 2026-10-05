import { describe, expect, it } from 'vitest'
import { countDays, createTabularAdapter, guessMapping, mappingProblems, parseCsv, PLATE_CHECK_NOTE } from './tabular'

// Nachbau der Vorlage „ParkHandling_Buchungsliste“, Sheet „Buchungseingänge“ (mit Titelzeile)
const csv = `﻿ParkHandling – Buchungseingänge;;;;;;;;;;;;;;;;;
Buchungs-Nr.;Eingang am;Status;Kunde / Firma;Telefon;E-Mail;Fahrzeug / Kennzeichen;Leistung;Anreise / Fahrzeugabgabe;Abholung / Rückgabe;Anzahl Tage;Parkplatz;Aufbereitung / Pflege;Hol- & Bringservice;Transfer Flughafen;Preis (€);Zahlungsstatus;Besondere Wünsche / Notizen
PH-1001;20.09.2026;Bestätigt;Erika Muster;0151 1234567;erika@example.com;Tesla Model 3 / M-EM 2026E;Premium-Stellplatz;24.09.2026 06:30;01.10.2026 22:15;8;Halle;Innen + Außen;nein;Shuttle;"249,00 €";bezahlt;Bitte laden
PH-1002;21.09.2026;Storniert;Muster Logistik GmbH;;;VW ID 4;Park & Fly;25.09.2026 07:00;27.09.2026 10:00;3;Außen mit Plane;;ja;;"89,50";offen;
PH-1003;21.09.2026;Bestätigt;Hans Test;;;M-HT 2 Audi A4;Park & Fly;26.09.2026 07:00;25.09.2026 10:00;0;Außen;;;;;;
`

describe('Vorlage ParkHandling_Buchungsliste', () => {
  const table = parseCsv(csv)
  const mapping = guessMapping(table.headers)
  const adapter = createTabularAdapter({ source: 'excel', mapping })

  it('findet die Kopfzeile unter einer Titelzeile', () => {
    expect(table.headers[0]).toBe('Buchungs-Nr.')
    expect(table.rows).toHaveLength(3)
  })

  it('ordnet alle Spalten der Vorlage zu, „Anzahl Tage“ bewusst nicht', () => {
    expect(mapping).toMatchObject({
      external_ref: 0,
      received_at: 1,
      status: 2,
      customer: 3,
      customer_phone: 4,
      customer_email: 5,
      vehicle: 6,
      service_kind: 7,
      start_at: 8,
      end_at: 9,
      parking: 11,
      cleaning: 12,
      pickup_delivery: 13,
      transfer: 14,
      price: 15,
      payment_status: 16,
      notes: 17,
    })
    expect(Object.values(mapping)).not.toContain(10)
    expect(mappingProblems(mapping)).toEqual([])
  })

  it('normalisiert eine vollständige Zeile', () => {
    const r = adapter.normalize(table.rows[0])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.booking).toMatchObject({
      external_ref: 'PH-1001',
      received_at: '2026-09-19T22:00:00.000Z',
      customer_name: 'Erika Muster',
      plate: 'M-EM 2026E',
      vehicle_model: 'Tesla Model 3',
      start_at: '2026-09-24T04:30:00.000Z',
      end_at: '2026-10-01T20:15:00.000Z',
      parking_type: 'indoor',
      return_mode: 'shuttle',
      services: ['AUF_INNEN', 'AUF_AUSSEN'],
      price_total: 249,
      payment_status: 'paid',
      notes: 'Bitte laden',
      cancelled: false,
    })
    expect(r.warnings).toEqual([])
    expect(countDays(r.booking.start_at, r.booking.end_at)).toBe(8)
  })

  it('erkennt Storno, Firma, Hol- & Bringservice und markiert unsichere Kennzeichen', () => {
    const r = adapter.normalize(table.rows[1])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.booking).toMatchObject({
      cancelled: true,
      company: 'Muster Logistik GmbH',
      return_mode: 'pickup_delivery',
      parking_type: 'outdoor_cover',
      plate: 'VW ID 4',
      price_total: 89.5,
      payment_status: 'open',
    })
    expect(r.booking.notes).toContain(PLATE_CHECK_NOTE)
    expect(r.warnings.join()).toMatch(/nicht sicher trennbar/)
  })

  it('meldet Fehler statt falsche Daten zu importieren', () => {
    const r = adapter.normalize(table.rows[2])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('Abholung liegt nicht nach der Anreise')
  })
})

describe('parseCsv', () => {
  it('verarbeitet Komma-CSV mit maskierten Anführungszeichen und CRLF', () => {
    const t = parseCsv('Kunde,Kennzeichen\r\n"x ""y""",M-AB 1\r\n')
    expect(t.rows).toEqual([['x "y"', 'M-AB 1']])
  })
})
