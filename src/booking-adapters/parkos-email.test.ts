import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeEncodedWords, decodeMail, htmlToText } from './mail/decode'
import { detectMailType, parseParkosMail, toImportPayload, type ParkosOptions } from './parkos-email'
import { normalizePlate } from './plate'

const html = readFileSync(fileURLToPath(new URL('./__fixtures__/parkos-neu.html', import.meta.url)), 'utf-8')

const options: ParkosOptions = {
  productMap: [{ parkos_label: 'Shuttle-Transfer (nicht überdacht)', parking_type: 'outdoor', return_mode: 'shuttle' }],
  bufferMinutes: 60,
}

/** Minimaler Quoted-Printable-Encoder (UTF-8) für Test-Mails */
function qp(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let out = ''
  let line = 0
  for (const b of bytes) {
    const ch = b === 10 ? '\n' : b >= 33 && b <= 126 && b !== 61 ? String.fromCharCode(b) : b === 32 ? ' ' : `=${b.toString(16).toUpperCase().padStart(2, '0')}`
    if (ch === '\n') {
      out += '\n'
      line = 0
      continue
    }
    if (line + ch.length > 75) {
      out += '=\n'
      line = 0
    }
    out += ch
    line += ch.length
  }
  return out
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function eml(body: string, from = 'Parkos <support@parkos.com>', subject = '=?utf-8?Q?Reservierung_bei_Parkos_#494PHBR?=') {
  return [
    `From: ${from}`,
    'To: fly@parkhandling.com',
    `Subject: ${subject}`,
    'Date: Thu, 22 Oct 2026 09:51:00 +0200',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64('Nur Text-Teil'),
    '--b1',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    qp(body),
    '--b1--',
    '',
  ].join('\r\n')
}

/** So sieht die Mail aus, wenn man sie am Handy markiert und einfügt */
const pasted = `Reservierung bei Parkos #494PHBR
Eine neue Reservierung über Parkos
Kundendaten:
Reservierungsnummer:
494PHBR
Vor- und Nachname:
Max Mustermann
Tel.: (mobil):
+49 160 1234567
Sprache:
Deutsch
Parkplatz:
Parkplatz:
ParkHandling Park&Fly
Tel.: (mobil):
+49 89 0000000
Reservierungsdaten:
Informationen zum Fahrzeug:
Ford Focus
Autokennzeichen:
M MM 3839
Anzahl Personen:
1
Parkform:
Shuttle-Transfer (nicht
überdacht)
Transfer Typ:
Inklusive Transfer (16 Minuten)
Flugnummer Hinreise:
LH123
Ankunftsdatum Parkplatz:
Fr. 23.10.2026
Zeitpunkt Ankunft Parkplatz:
12:00
Flugnummer Rückreise:
LH234
Datum Rückkehr Flughafen:
Mi. 28.10.2026
Zeitpunkt Rückkehr Flughafen:
12:00
6 Tage Shuttle-Transfer (nicht überdacht) € 72,00
Gesamtumsatz ParkHandling Park&Fly € 72,00
Gesamtbetrag Kunde (im Voraus bei Parkos bezahlt) € 72,00`

describe('Mail-Dekodierung', () => {
  it('dekodiert Betreff nach RFC 2047', () => {
    expect(decodeEncodedWords('=?utf-8?Q?R=C3=BCckkehr_Flughafen?=')).toBe('Rückkehr Flughafen')
    expect(decodeEncodedWords('=?UTF-8?B?UmVzZXJ2aWVydW5n?= bei Parkos')).toBe('Reservierung bei Parkos')
  })

  it('macht aus HTML lesbaren Text ohne Bilder und Stile', () => {
    const text = htmlToText(html)
    expect(text).toContain('Reservierungsnummer:\t494PHBR')
    expect(text).toContain('Flughafen München')
    expect(text).not.toContain('<')
    expect(text).not.toContain('font-family')
    expect(text).not.toContain('logo.png')
  })

  it('liest eine .eml (multipart, quoted-printable, Umlaute) und bevorzugt den HTML-Teil', () => {
    const mail = decodeMail(eml(html))
    expect(mail.format).toBe('eml')
    expect(mail.subject).toBe('Reservierung bei Parkos #494PHBR')
    expect(mail.from).toBe('Parkos <support@parkos.com>')
    expect(mail.date).toBe('2026-10-22T07:51:00.000Z')
    expect(mail.text).toContain('Datum Rückkehr Flughafen:')
    expect(mail.text).not.toContain('Nur Text-Teil')
  })
})

describe('Parkos-Mail', () => {
  for (const [name, raw] of [
    ['HTML eingefügt', html],
    ['.eml hochgeladen', eml(html)],
    ['Text vom Handy eingefügt', pasted],
  ] as const) {
    it(`liest die Testbuchung vollständig (${name})`, () => {
      const r = parseParkosMail(raw, options)
      expect(r.errors).toEqual([])
      expect(r.mailType).toBe('new')
      expect(r.externalRef).toBe('494PHBR')
      expect(r.flags).toEqual([])
      const b = r.booking!
      expect(b).toMatchObject({
        external_ref: '494PHBR',
        customer_name: 'Max Mustermann',
        customer_phone: '+49 160 1234567',
        customer_email: null,
        customer_language: 'de',
        vehicle_model: 'Ford Focus',
        plate: 'M-MM 3839',
        persons: 1,
        parking_type: 'outdoor',
        return_mode: 'shuttle',
        transfer_note: 'Inklusive Transfer (16 Minuten)',
        flight_out: 'LH123',
        flight_return: 'LH234',
        price_total: 72,
        payment_status: 'paid',
      })
      expect(r.portalPayout).toBe(72)
      expect(r.fields.parkform).toBe('Shuttle-Transfer (nicht überdacht)')
    })
  }

  it('verwechselt die Kundennummer nicht mit der Betriebsnummer', () => {
    const withoutCustomerPhone = html.replace(
      /<tr><td class="label">Tel\.: \(mobil\):<\/td><td><a href="tel:\+491601234567">[^<]*<\/a><\/td><\/tr>/,
      '',
    )
    const r = parseParkosMail(withoutCustomerPhone, options)
    expect(r.booking?.customer_phone).toBeNull()
    expect(r.flags).toContain('phone_missing')
  })

  it('rechnet über die Zeitumstellung korrekt (MESZ → MEZ) und addiert den Puffer', () => {
    const r = parseParkosMail(html, options)
    expect(r.booking!.start_at).toBe('2026-10-23T10:00:00.000Z')
    expect(r.booking!.return_flight_at).toBe('2026-10-28T11:00:00.000Z')
    expect(r.booking!.end_at).toBe('2026-10-28T12:00:00.000Z') // 13:00 Ortszeit
    const r90 = parseParkosMail(html, { ...options, bufferMinutes: 90 })
    expect(r90.booking!.end_at).toBe('2026-10-28T12:30:00.000Z')
  })

  it('unbekannte Parkform → Hinweis, kein Abbruch; Parkart von Hand möglich', () => {
    const other = html.replace('Shuttle-Transfer (nicht überdacht)</td>', 'Valet Parking Halle</td>')
    const r = parseParkosMail(other, options)
    expect(r.flags).toContain('unknown_product')
    expect(r.errors).toEqual([])
    expect(r.booking).not.toBeNull()
    const manual = parseParkosMail(other, { ...options, parkingTypeOverride: 'indoor' })
    expect(manual.flags).toContain('parking_type_manual')
    expect(manual.flags).not.toContain('unknown_product')
    expect(manual.booking!.parking_type).toBe('indoor')
  })

  it('Zuordnung der Parkform ignoriert Groß-/Kleinschreibung und Leerzeichen', () => {
    const r = parseParkosMail(html.replace('Shuttle-Transfer (nicht überdacht)</td>', 'shuttle-transfer ( nicht  überdacht )</td>'), options)
    expect(r.flags).not.toContain('unknown_product')
  })

  it('markiert nicht zerlegbare Kennzeichen', () => {
    const r = parseParkosMail(html.replace('M MM 3839', 'MMM3839'), options)
    expect(r.booking!.plate).toBe('MMM3839')
    expect(r.flags).toContain('plate_unverified')
  })

  it('markiert .eml mit fremdem Absender', () => {
    const r = parseParkosMail(eml(html, 'Betrueger <support@parkos.co>'), options)
    expect(r.flags).toContain('sender_unverified')
    const ok = parseParkosMail(eml(html, 'Parkos <noreply@mail.parkos.com>'), options)
    expect(ok.flags).not.toContain('sender_unverified')
  })

  it('erkennt Umbuchung und Stornierung (nur zur Prüfung) und unbekannte Mails', () => {
    expect(detectMailType('Reservierung bei Parkos #494PHBR', 'Eine neue Reservierung über Parkos …')).toBe('new')
    expect(detectMailType('Stornierung bei Parkos #494PHBR', 'Die Reservierung wurde storniert')).toBe('cancel')
    expect(detectMailType('Änderung Ihrer Reservierung #494PHBR', 'Die Reservierung wurde geändert')).toBe('change')
    expect(detectMailType('Newsletter', 'Hallo')).toBe('unknown')
    const unknown = parseParkosMail('Hallo, wie geht es?', options)
    expect(unknown.mailType).toBe('unknown')
    expect(unknown.booking).toBeNull()
  })

  it('die Fußzeile „Stornierungsbedingungen“ macht aus einer neuen Reservierung kein Storno', () => {
    expect(parseParkosMail(html, options).mailType).toBe('new')
  })

  it('meldet fehlende Pflichtangaben', () => {
    const r = parseParkosMail(html.replace('<td>494PHBR</td>', '<td></td>').replace('M MM 3839', ''), options)
    expect(r.booking).toBeNull()
    expect(r.errors).toContain('Kennzeichen fehlt')
  })

  it('erzeugt den Datensatz für import_booking_mail', () => {
    const p = toImportPayload(parseParkosMail(eml(html), options), 'imap')
    expect(p).toMatchObject({
      source: 'parkos',
      channel: 'imap',
      mail_type: 'new',
      external_ref: '494PHBR',
      sender: 'support@parkos.com',
      portal_payout: 72,
      flags: [],
    })
    expect(p.raw_text).toContain('Reservierungsnummer')
    expect(p.raw_text.length).toBeLessThan(200_000)
    expect(p.services).toEqual([])
  })

  it('nur das Parkprodukt → keine Zusatzleistungen', () => {
    for (const raw of [html, pasted]) expect(parseParkosMail(raw, options).fields.extras).toEqual([])
  })

  const charge = 'E-Ladeservice (exclusive Stormkosten) € 10,00'
  for (const [name, raw] of [
    ['Text', pasted.replace('Gesamtumsatz ParkHandling', `${charge}\nGesamtumsatz ParkHandling`)],
    ['Text, Betrag in eigener Zeile', pasted.replace('Gesamtumsatz ParkHandling', 'E-Ladeservice (exclusive Stormkosten)\n€ 10,00\nGesamtumsatz ParkHandling')],
    ['HTML', html.replace('überdacht)</td><td align="right">&euro; 72,00</td></tr>', '$&<tr><td>E-Ladeservice (exclusive Stormkosten)</td><td align="right">&euro; 10,00</td></tr>')],
  ] as const) {
    it(`übernimmt den E-Ladeservice als Leistung LADEN (${name})`, () => {
      const r = parseParkosMail(raw, options)
      expect(r.fields.extras).toEqual([{ label: 'E-Ladeservice (exclusive Stormkosten)', price: 10, code: 'LADEN' }])
      expect(r.flags).toEqual([])
      expect(toImportPayload(r, 'manual').services).toEqual([
        { code: 'LADEN', price: 10, description: 'E-Ladeservice (exclusive Stormkosten)' },
      ])
    })
  }

  it('Umbuchung: Zusatzleistungen aus „Neue Daten“, nicht aus der alten Tabelle', () => {
    const change = pasted
      .replace('Eine neue Reservierung über Parkos', 'Reservierung über Parkos geändert')
      .replace(
        /6 Tage Shuttle[\s\S]*$/,
        [
          '4 days Shuttle transfer (outside) € 49,00',
          'Total revenue ParkHandling Park&Fly € 49,00',
          'Total Customer (Paid upfront at Parkos) € 49,00',
          'Neue Daten:',
          '4 Tage Shuttle-Transfer (nicht überdacht) € 49,00',
          'E-Ladeservice (exclusive Stormkosten) € 10,00',
          'Gesamtumsatz ParkHandling Park&Fly € 59,00',
          'Gesamtbetrag Kunde (im Voraus bei Parkos bezahlt) € 59,00',
        ].join('\n'),
      )
    const r = parseParkosMail(change, options)
    expect(r.mailType).toBe('change')
    expect(r.fields.extras.map((x) => x.code)).toEqual(['LADEN'])
    expect(r.portalPayout).toBe(59)
  })

  it('unbekannte Zusatzleistung → Hinweis, nicht als Leistung übernommen', () => {
    const r = parseParkosMail(pasted.replace('Gesamtumsatz ParkHandling', 'Kindersitz € 5,00\nGesamtumsatz ParkHandling'), options)
    expect(r.fields.extras).toEqual([{ label: 'Kindersitz', price: 5, code: null }])
    expect(r.flags).toContain('unknown_extra')
    expect(toImportPayload(r, 'manual').services).toEqual([])
  })
})

describe('Anzahl Tage', () => {
  it('zählt Kalendertage inklusive, auch über die Zeitumstellung', async () => {
    const { countDays } = await import('./tabular')
    expect(countDays('2026-10-23T10:00:00Z', '2026-10-28T12:00:00Z')).toBe(6)
    expect(countDays('2026-10-23T10:00:00Z', '2026-10-28T10:00:00Z')).toBe(6) // 11:00 Ortszeit, < 5 × 24 h
    expect(countDays('2026-10-23T10:00:00Z', '2026-10-23T18:00:00Z')).toBe(1)
    expect(countDays('2026-10-23T21:30:00Z', '2026-10-24T05:00:00Z')).toBe(2) // 23:30 → 07:00
  })
})

describe('Kennzeichen', () => {
  it.each([
    ['M MM 3839', 'M-MM 3839', true],
    ['m-mm3839', 'M-MM 3839', true],
    ['FFB-AB 12E', 'FFB-AB 12E', true],
    ['  ED  X 1  ', 'ED-X 1', true],
    ['MMM3839', 'MMM3839', false],
    ['W-12345A', 'W-12345A', false],
  ])('%s → %s', (raw, plate, verified) => {
    expect(normalizePlate(raw)).toEqual({ plate, verified })
  })
})
