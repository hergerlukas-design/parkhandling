import { describe, expect, it } from 'vitest'
import { protocolFilename } from './protocolPdf'
import {
  buildPdfData,
  compareWithIntake,
  formFromRow,
  formatMileage,
  normalizeDamage,
  parseMileage,
  pickSlotUrls,
  saveErrorMessage,
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

describe('Kilometerstand 0.14.1: Dezimalkomma wird zum Punkt-Wert', () => {
  it('wandelt „12345,6“ in 12345.6 um (Wert für numeric(10,1))', () => {
    expect(parseMileage('12345,6')).toBe(12345.6)
    expect(parseMileage('12345,6')).not.toBe(12345)
  })

  it('liest den gespeicherten Wert wieder mit Dezimalkomma ein', () => {
    const f = formFromRow(
      { mileage: 12345.6, status: 'draft', type: 'intake', conditions: [], damages: [], fuel_level: null } as never,
      { type: 'intake', booking, inspectorName: 'Mitarbeiter 1' },
    )
    expect(f.mileage).toBe('12345,6')
  })

  it('erkennt einen Kilometerstand mit Dezimalkomma als gültige Eingabe bei der Abschlussprüfung', () => {
    const errors = validateForFinalize(form({ mileage: '12345,6' }), 'combustion', { staff: true, customer: true })
    expect(errors.some((e) => e.includes('Kilometerstand'))).toBe(false)
  })
})

describe('Anzeige Kilometerstand', () => {
  it('zeigt Dezimalkomma und lässt „,0“ weg', () => {
    expect(formatMileage(84213.5)).toBe('84213,5')
    expect(formatMileage(48210)).toBe('48210')
  })
})

describe('saveErrorMessage', () => {
  it('nennt bei veraltetem Schema die fehlende Migration', () => {
    const msg = saveErrorMessage(new Error('invalid input syntax for type integer: "12345.6"'))
    expect(msg).toContain('20261008000100')
    expect(msg).toContain('invalid input syntax for type integer')
  })

  it('erklärt Verbindungsfehler als nur lokal gesichert', () => {
    expect(saveErrorMessage(new Error('Failed to fetch'))).toContain('nur auf diesem Gerät')
  })

  it('zeigt unbekannte Fehler mit ihrem Grund', () => {
    expect(saveErrorMessage(new Error('permission denied'))).toBe('Speichern fehlgeschlagen: permission denied')
    expect(saveErrorMessage('plain')).toBe('Speichern fehlgeschlagen: plain')
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

  it('verlangt bei E-Fahrzeugen keinen Tankstand (Akkustand entfällt)', () => {
    const errors = validateForFinalize(form({ fuel_level: null }), 'electric', { staff: true, customer: true })
    expect(errors).toEqual([])
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
      fuel_level: 6,
      damages: [{ id: 'x', pos: 'Dach', type: 'Kratzer', int: 'Mittel' }],
    }
    const handover = form({
      mileage: '48120,5',
      fuel_level: 4,
      damages: [
        { id: 'y', pos: 'Dach', desc: 'Kratzer, etwas größer' },
        { id: 'z', pos: 'Tür vorne links', desc: 'Delle, tief' },
      ],
    })
    const c = compareWithIntake(intake, handover)
    expect(c.mileageDiff).toBe(120.5)
    expect(c.fuelDiff).toBe(-2)
    expect(c.newDamages.map((d) => d.id)).toEqual(['z'])
    expect(c.lines).toContain('KM seit Annahme: +120.5 km (Annahme 48000 km)')
    expect(c.lines).toContain('Tank: -2 Segmente (Annahme 6/8)')
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
