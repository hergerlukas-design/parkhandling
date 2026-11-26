import { describe, expect, it } from 'vitest'
import { protocolFilename } from './protocolPdf'
import {
  buildPdfData,
  gaugePhotoLabel,
  pdfLabels,
  compareWithIntake,
  formFromRow,
  formatMileage,
  normalizeDamage,
  parseMileage,
  pickSlotUrls,
  validateForFinalize,
  type ProtocolBooking,
  type ProtocolForm,
} from './protocols'

const booking: ProtocolBooking = {
  id: 'b1',
  plate: 'M-PF 1001',
  vehicle_model: 'VW Golf',
  fuel_type: 'combustion',
  customer_name: 'Erika Test',
  customer_email: 'erika@example.com',
  status: 'booked',
  start_at: '2026-10-06T06:00:00Z',
  end_at: '2026-10-10T18:00:00Z',
}

function form(patch: Partial<ProtocolForm> = {}): ProtocolForm {
  return {
    ...formFromRow(null, { type: 'intake', booking, inspectorName: 'Mitarbeiter 1' }),
    mileage: '48.210',
    fuel_level: 4,
    charge_level: null,
    ...patch,
  }
}

describe('parseMileage', () => {
  it('akzeptiert Tausenderpunkte und Leerzeichen', () => {
    expect(parseMileage('48.210')).toBe(48210)
    expect(parseMileage('48 210')).toBe(48210)
    expect(parseMileage('')).toBeNull()
    expect(parseMileage('12a')).toBeNull()
  })

  it('akzeptiert Dezimalkomma mit einer Nachkommastelle', () => {
    expect(parseMileage('84213,5')).toBe(84213.5)
    expect(parseMileage('84.213,5')).toBe(84213.5)
    expect(parseMileage('84213')).toBe(84213)
    expect(parseMileage('84213,55')).toBeNull()
    expect(parseMileage('84213,')).toBeNull()
  })
})

describe('Anzeige Kilometerstand', () => {
  it('zeigt Dezimalkomma und lässt „,0“ weg', () => {
    expect(formatMileage(84213.5)).toBe('84213,5')
    expect(formatMileage(48210)).toBe('48210')
  })
})

describe('formFromRow', () => {
  it('setzt Vorgaben für die Annahme', () => {
    const f = formFromRow(null, { type: 'intake', booking, inspectorName: 'Mitarbeiter 1' })
    expect(f.inspector_name).toBe('Mitarbeiter 1')
    expect(f.location_text).toBe('Park & Fly Flughafen München')
    expect(f.customer_signer_name).toBe('Erika Test')
    expect(f.damages).toEqual([])
  })

  it('belegt Kennzeichen und Antrieb aus der Buchung vor', () => {
    const f = formFromRow(null, { type: 'intake', booking, inspectorName: 'M1' })
    expect(f.plate).toBe('M-PF 1001')
    expect(f.fuel_type).toBe('combustion')
    expect(formFromRow(null, { type: 'intake', booking: { ...booking, fuel_type: null }, inspectorName: 'M1' }).fuel_type).toBeNull()
  })

  it('übernimmt bei der Übergabe Kennzeichen und Antrieb aus der Annahme', () => {
    const intake = { plate: 'M-PF 1002', fuel_type: 'hybrid' } as never
    const f = formFromRow(null, { type: 'handover', booking, inspectorName: 'M2', intake })
    expect(f.plate).toBe('M-PF 1002')
    expect(f.fuel_type).toBe('hybrid')
    expect(f.location_text).toBe('Park & Fly Flughafen München → Erika Test')
  })

  it('übernimmt bei der Übergabe den KM-Stand der Annahme', () => {
    const intake = { mileage: 84213.5 } as never
    expect(formFromRow(null, { type: 'handover', booking, inspectorName: 'M2', intake }).mileage).toBe('84213,5')
  })
})

describe('validateForFinalize', () => {
  it('verlangt KM, Tank und beide Unterschriften', () => {
    const errors = validateForFinalize(form({ mileage: '', fuel_level: null }), { staff: false, customer: false })
    expect(errors).toEqual([
      'Kilometerstand fehlt oder ist ungültig',
      'Tankstand fehlt',
      'Unterschrift Mitarbeiter fehlt',
      'Unterschrift Kunde fehlt',
    ])
  })

  it('verlangt bei E-Fahrzeugen den Ladestand statt des Tankstands', () => {
    const sigs = { staff: true, customer: true }
    expect(validateForFinalize(form({ fuel_type: 'electric', fuel_level: null }), sigs)).toEqual(['Ladestand fehlt'])
    expect(validateForFinalize(form({ fuel_type: 'electric', fuel_level: null, charge_level: 0 }), sigs)).toEqual([])
  })

  it('verlangt bei Hybrid Tank- und Ladestand', () => {
    const errors = validateForFinalize(form({ fuel_type: 'hybrid', fuel_level: null }), { staff: true, customer: true })
    expect(errors).toEqual(['Tankstand fehlt', 'Ladestand fehlt'])
  })

  it('verlangt Antrieb und Kennzeichen', () => {
    const errors = validateForFinalize(form({ fuel_type: null, plate: ' ' }), { staff: true, customer: true })
    expect(errors).toEqual(['Kennzeichen fehlt', 'Antrieb wählen (Verbrenner, Hybrid oder Elektro)'])
  })

  it('verlangt bei ausgeschaltetem Zustand weder KM-Stand noch Antrieb, Tank- oder Ladestand', () => {
    const off = form({ condition_recorded: false, mileage: '', fuel_type: null, fuel_level: null })
    expect(validateForFinalize(off, { staff: true, customer: true })).toEqual([])
    expect(validateForFinalize(off, { staff: false, customer: false })).toEqual(['Unterschrift Mitarbeiter fehlt', 'Unterschrift Kunde fehlt'])
  })

  it('verlangt vollständige Schadensangaben', () => {
    const errors = validateForFinalize(
      form({ damages: [{ id: 'a', pos: 'Dach', desc: '  ' }, { id: 'b', pos: '', desc: 'Delle' }] }),
      { staff: true, customer: true },
    )
    expect(errors).toEqual(['Schaden 1: Position und Beschreibung angeben', 'Schaden 2: Position und Beschreibung angeben'])
  })
})

describe('normalizeDamage', () => {
  it('führt ältere Einträge mit Art und Intensität in Freitext über', () => {
    expect(normalizeDamage({ id: 'x', pos: 'Dach', type: 'Kratzer', int: 'Mittel' })).toEqual({ id: 'x', pos: 'Dach', desc: 'Kratzer, Mittel' })
    expect(normalizeDamage({ id: 'y', pos: 'Dach', desc: 'Delle' })).toEqual({ id: 'y', pos: 'Dach', desc: 'Delle' })
  })
})

describe('compareWithIntake', () => {
  it('berechnet Differenzen und neue Schäden', () => {
    const intake = {
      mileage: 48000,
      fuel_level: 6,
      charge_level: 80,
      damages: [{ id: 'x', pos: 'Dach', type: 'Kratzer', int: 'Mittel' }],
    }
    const handover = form({
      mileage: '48120,5',
      fuel_level: 4,
      charge_level: 35,
      damages: [
        { id: 'y', pos: 'Dach', desc: 'Kratzer, etwas größer' },
        { id: 'z', pos: 'Tür vorne links', desc: 'Delle, tief' },
      ],
    })
    const c = compareWithIntake(intake, handover)
    expect(c.mileageDiff).toBe(120.5)
    expect(c.fuelDiff).toBe(-2)
    expect(c.chargeDiff).toBe(-45)
    expect(c.newDamages.map((d) => d.id)).toEqual(['z'])
    expect(c.lines).toContain('KM seit Annahme: +120.5 km (Annahme 48000 km)')
    expect(c.lines).toContain('Tank: -2 Segmente (Annahme 6/8)')
    expect(c.lines).toContain('Ladestand: -45 % (Annahme 80 %)')
    expect(c.lines).toContain('Neue Schäden seit Annahme: Tür vorne links (Delle, tief)')
  })

  it('meldet fehlende Annahme', () => {
    expect(compareWithIntake(null, form()).lines).toEqual(['Kein Annahmeprotokoll vorhanden'])
  })
})

describe('pickSlotUrls / buildPdfData', () => {
  it('nimmt je Slot das neueste Foto und nummeriert Zusatzfotos', () => {
    const urls = pickSlotUrls([
      { slot: 'vorne', url: 'alt', created_at: '2026-10-06T08:00:00Z' },
      { slot: 'vorne', url: 'neu', created_at: '2026-10-06T08:05:00Z' },
      { slot: 'zusatz', url: 'z1', created_at: '2026-10-06T08:01:00Z' },
      { slot: 'zusatz', url: 'z2', created_at: '2026-10-06T08:02:00Z' },
      { slot: 'pdf', url: 'p', created_at: '2026-10-06T08:03:00Z' },
    ])
    expect(urls).toEqual({ vorne: 'neu', zusatz_0: 'z1', zusatz_1: 'z2' })
  })

  it('führt alte Fahrzeugschein-Fotos als Zusatzfotos und übernimmt das Anzeige-Foto', () => {
    const urls = pickSlotUrls([
      { slot: 'schein', url: 's', created_at: '2026-10-06T08:00:00Z' },
      { slot: 'anzeige', url: 'a', created_at: '2026-10-06T08:01:00Z' },
      { slot: 'zusatz', url: 'z', created_at: '2026-10-06T08:02:00Z' },
    ])
    expect(urls).toEqual({ zusatz_0: 's', anzeige: 'a', zusatz_1: 'z' })
    const data = buildPdfData({ type: 'intake', status: 'final', form: form(), booking, slotUrls: urls, inspectionDate: '2026-10-06T08:00:00Z' })
    expect(data.photos.anzeige).toBe('a')
  })

  it('übernimmt Kennzeichen und Antrieb ins PDF, Tank/Ladestand passend zum Antrieb', () => {
    const base = { type: 'intake' as const, status: 'final' as const, booking, slotUrls: {}, inspectionDate: '2026-10-06T08:00:00Z' }
    const e = buildPdfData({ ...base, form: form({ plate: 'M-XY 9', fuel_type: 'electric', fuel_level: 5, charge_level: 70 }) })
    expect(e.license_plate).toBe('M-XY 9')
    expect(e.drive).toBe('Elektro')
    expect([e.fuel_level, e.charge_level]).toEqual([null, 70])
    const c = buildPdfData({ ...base, form: form({ fuel_type: 'combustion', fuel_level: 5, charge_level: 70 }) })
    expect([c.drive, c.fuel_level, c.charge_level]).toEqual(['Verbrenner', 5, null])
    const h = buildPdfData({ ...base, form: form({ fuel_type: 'hybrid', fuel_level: 5, charge_level: 70 }) })
    expect([h.drive, h.fuel_level, h.charge_level]).toEqual(['Hybrid', 5, 70])
  })

  it('lässt den Zustand im PDF weg, wenn er ausgeschaltet ist', () => {
    const base = { type: 'intake' as const, status: 'final' as const, booking, slotUrls: {}, inspectionDate: '2026-10-06T08:00:00Z' }
    const d = buildPdfData({ ...base, form: form({ condition_recorded: false, fuel_level: 5, conditions: ['Regen'] }) })
    expect([d.condition_recorded, d.odometer, d.fuel_level, d.charge_level, d.conditions]).toEqual([false, null, null, null, []])
    expect(pdfLabels('intake', null, false).section4).toBe('2. Bemerkungen')
    expect(pdfLabels('intake').section4).toBe('3. Bemerkungen')
  })

  it('beschriftet das Anzeige-Foto nach Antriebsart', () => {
    expect(gaugePhotoLabel('electric')).toBe('Ladestand')
    expect(gaugePhotoLabel('hybrid')).toBe('Tank-/Ladestand')
    expect(gaugePhotoLabel(null)).toBe('Tankanzeige')
    expect(pdfLabels('handover', 'electric').photo?.anzeige).toBe('Ladestand')
  })

  it('ordnet Schadensfotos nach Position in der Liste und Unterschriften der Vorlage zu', () => {
    const f = form({
      damages: [
        { id: 'aa', pos: 'Dach', desc: 'Kratzer' },
        { id: 'bb', pos: 'Motorhaube', desc: ' Delle, tief ' },
      ],
    })
    const slotUrls = { schaden_bb: 'u-bb', signature: 'sig', signature_customer: 'kunde', vorne: 'v' }
    const intake = buildPdfData({ type: 'intake', status: 'final', form: f, booking, slotUrls, inspectionDate: '2026-10-06T08:00:00Z' })
    expect(intake.protocol_type).toBe('annahme')
    expect(intake.photos).toEqual({ schaden_1: 'u-bb', signature: 'sig', signature_carrier: 'kunde', vorne: 'v' })
    expect(intake.odometer).toBe(48210)
    expect(intake.remarks).toContain('Fahrzeug übergeben von: Erika Test')
    expect(intake.damage_records[1]).toEqual({ pos: 'Motorhaube', desc: 'Delle, tief' })
    expect(intake.checkliste).toBeUndefined()

    const handover = buildPdfData({ type: 'handover', status: 'final', form: f, booking, slotUrls, inspectionDate: '2026-10-06T08:00:00Z' })
    expect(handover.protocol_type).toBe('transfer')
    expect(handover.photos.signature_receiver).toBe('kunde')
    expect(handover.receiver_name).toBe('Erika Test')
  })
})

describe('protocolFilename', () => {
  it('nutzt das Datum in Europe/Berlin', () => {
    expect(protocolFilename('intake', 'M-PF 1001', '2026-10-05T22:30:00Z')).toBe('Annahme_M-PF-1001_2026-10-06.pdf')
    expect(protocolFilename('handover', 'M-PF 1001', '2026-10-06T10:00:00Z')).toBe('Uebergabe_M-PF-1001_2026-10-06.pdf')
  })
})
