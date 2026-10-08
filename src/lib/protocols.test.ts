import { describe, expect, it } from 'vitest'
import { protocolFilename } from './protocolPdf'
import {
  buildPdfData,
  compareWithIntake,
  formFromRow,
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
    fuel_level: 50,
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
})

describe('formFromRow', () => {
  it('setzt Vorgaben für die Annahme', () => {
    const f = formFromRow(null, { type: 'intake', booking, inspectorName: 'Mitarbeiter 1' })
    expect(f.inspector_name).toBe('Mitarbeiter 1')
    expect(f.location_text).toBe('Park & Fly Flughafen München')
    expect(f.customer_signer_name).toBe('Erika Test')
    expect(f.damages).toEqual([])
  })

  it('übernimmt bei der Übergabe die FIN aus der Annahme', () => {
    const intake = { vin: 'WVWZZZ1KZ6W000001' } as never
    const f = formFromRow(null, { type: 'handover', booking, inspectorName: 'M2', intake })
    expect(f.vin).toBe('WVWZZZ1KZ6W000001')
    expect(f.location_text).toBe('Park & Fly Flughafen München → Erika Test')
  })
})

describe('validateForFinalize', () => {
  it('verlangt KM, Tank und beide Unterschriften', () => {
    const errors = validateForFinalize(form({ mileage: '', fuel_level: null }), 'combustion', { staff: false, customer: false })
    expect(errors).toEqual([
      'Kilometerstand fehlt oder ist ungültig',
      'Tankstand fehlt',
      'Unterschrift Mitarbeiter fehlt',
      'Unterschrift Kunde fehlt',
    ])
  })

  it('verlangt bei E-Fahrzeugen den Akkustand statt Tank', () => {
    const errors = validateForFinalize(form({ fuel_level: null }), 'electric', { staff: true, customer: true })
    expect(errors).toEqual(['Akkustand fehlt'])
  })

  it('verlangt vollständige Schadensangaben', () => {
    const errors = validateForFinalize(
      form({ damages: [{ id: 'a', pos: 'Dach', desc: '  ' }, { id: 'b', pos: '', desc: 'Delle' }] }),
      'combustion',
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
      fuel_level: 75,
      soc_percent: null,
      damages: [{ id: 'x', pos: 'Dach', type: 'Kratzer', int: 'Mittel' }],
    }
    const handover = form({
      mileage: '48120',
      fuel_level: 50,
      damages: [
        { id: 'y', pos: 'Dach', desc: 'Kratzer, etwas größer' },
        { id: 'z', pos: 'Tür vorne links', desc: 'Delle, tief' },
      ],
    })
    const c = compareWithIntake(intake, handover)
    expect(c.mileageDiff).toBe(120)
    expect(c.fuelDiff).toBe(-25)
    expect(c.newDamages.map((d) => d.id)).toEqual(['z'])
    expect(c.lines).toContain('KM seit Annahme: +120 km (Annahme 48000 km)')
    expect(c.lines).toContain('Neue Schaeden seit Annahme: Tür vorne links (Delle, tief)')
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
    expect(intake.remarks).toContain('Fahrzeug uebergeben von: Erika Test')
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
