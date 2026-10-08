// ─────────────────────────────────────────────────────────────────────────────
// Fahrzeug-Protokoll-PDF (Annahme / Überführung) – eigenständige Vorlage.
//
// Kopie von pdf-template/src/generatePdf.ts aus fahrzeug-protokolle-v2 (5d29dc6),
// ergänzt um PdfOptions.labels, optionale Checkliste und Schadens-Freitext (desc).
// Ursprünglich ohne
// Abhängigkeiten auf den Rest der App. Einzige Abhängigkeit: pdf-lib.
// Das Logo wird von `logoUrl` geladen (Standard: /carhandling.png, also
// public/carhandling.png in einer Vite-App).
// ─────────────────────────────────────────────────────────────────────────────

import { PDFDocument, rgb, StandardFonts, degrees, type PDFPage, type PDFFont, type PDFImage } from 'pdf-lib'

// ─────────────────────────────────────────────────────────────────────────────
// Datentypen (aus protocols.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface DamageItem {
  /** Position, z.B. "Tür vorne links" (deutsche Schlüssel, werden für EN übersetzt) */
  pos: string
  /** Art, z.B. "Kratzer" */
  type?: string
  /** Intensität: "Oberflächlich" | "Mittel" | "Tief" */
  int?: string
  /** Freitext statt Art + Intensität (Park & Fly); ersetzt in der Tabelle beide Spalten */
  desc?: string
}

/** Links: sauber (true) / schmutzig (false). Rechts: vorhanden ja/nein. */
export interface Checkliste {
  floor: boolean
  seats: boolean
  entry: boolean
  instruments: boolean
  trunk: boolean
  engine: boolean
  aid_kit: boolean
  triangle: boolean
  vest: boolean
  cable: boolean
  registration: boolean
  card: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Weitere Fotos (aus extraPhotos.ts): zusatz_0, zusatz_1, … in Reihenfolge
// ─────────────────────────────────────────────────────────────────────────────

const EXTRA_PHOTO_PREFIX = 'zusatz_'

function extraPhotoEntries(photos: Record<string, string>): [string, string][] {
  const idx = (k: string) => Number(k.slice(EXTRA_PHOTO_PREFIX.length)) || 0
  return Object.entries(photos)
    .filter(([k, url]) => k.startsWith(EXTRA_PHOTO_PREFIX) && !!url)
    .sort(([a], [b]) => idx(a) - idx(b))
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF label strings (DE / EN)
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfLabels {
  title_annahme: string; title_transfer: string; watermark: string
  section1: string; section2: string; section3: string; section4: string
  section5: string; section6: string; section7: string; extra_photo: string
  plate: string; brand_model: string; vin: string; creator: string
  odometer: string; location: string; receiver: string; from: string; to: string
  transfer_type_label: string; conditions: string; fuel: string; battery: string
  condition_header: string; equipment_header: string
  clean: string; dirty: string; yes: string; no: string
  carrier_sig: string; creator_sig_label: string; sig_creator: string; sig_receiver: string
  no_photo: string; damage_label: string
  photo: { vorne: string; hinten: string; links: string; rechts: string; schein: string }
  checklist: { floor: string; seats: string; entry: string; instruments: string; trunk: string; engine: string
               aid_kit: string; triangle: string; vest: string; cable: string; registration: string; card: string }
  damage_pos: string; damage_type: string; damage_intensity: string; damage_desc: string
}

const PDF_LABELS: Record<'de' | 'en', PdfLabels> = {
  de: {
    title_annahme: 'Fahrzeug-Annahmeprotokoll', title_transfer: 'Fahrzeug-Ueberfuehrungsprotokoll',
    watermark: 'VORLAEUFIGER ENTWURF',
    section1: '1. Basisdaten', section2: '2. Technik & Betriebsstoffe',
    section3: '3. Checkliste', section4: '4. Bemerkungen',
    section5: '5. Fotodokumentation', section6: '6. Erfasste Schaeden',
    section7: '7. Weitere Fotos', extra_photo: 'Foto',
    plate: 'Kennzeichen', brand_model: 'Marke / Modell', vin: 'VIN',
    creator: 'Ersteller', odometer: 'KM-Stand', location: 'Standort',
    receiver: 'Empfaenger', from: 'Von', to: 'Nach',
    transfer_type_label: 'Art der Ueberfuehrung', conditions: 'Bedingungen',
    fuel: 'Kraftstoff', battery: 'Batterie',
    condition_header: 'Zustand', equipment_header: 'Zubehoer',
    clean: 'Sauber', dirty: 'Schmutzig', yes: 'Ja', no: 'Nein',
    carrier_sig: 'Uebergabe durch Spediteur', creator_sig_label: 'Annahme durch (Ersteller)',
    sig_creator: 'Ersteller', sig_receiver: 'Empfaenger',
    no_photo: 'Kein Foto', damage_label: 'Schaden',
    photo: { vorne: 'Vorne', hinten: 'Hinten', links: 'Links', rechts: 'Rechts', schein: 'Schein' },
    checklist: { floor: 'Boden', seats: 'Sitze', entry: 'Einstiege', instruments: 'Armaturen',
                 trunk: 'Kofferraum', engine: 'Motorraum', aid_kit: 'Verbandskasten',
                 triangle: 'Warndreieck', vest: 'Warnweste', cable: 'Ladekabel',
                 registration: 'Fahrzeugschein', card: 'Ladekarte' },
    damage_pos: 'Position', damage_type: 'Art', damage_intensity: 'Intensitaet', damage_desc: 'Beschreibung',
  },
  en: {
    title_annahme: 'Vehicle Intake Protocol', title_transfer: 'Vehicle Transfer Protocol',
    watermark: 'PRELIMINARY DRAFT',
    section1: '1. Basic Data', section2: '2. Technical & Fluids',
    section3: '3. Checklist', section4: '4. Remarks',
    section5: '5. Photo Documentation', section6: '6. Recorded Damages',
    section7: '7. Additional Photos', extra_photo: 'Photo',
    plate: 'License Plate', brand_model: 'Make / Model', vin: 'VIN',
    creator: 'Inspector', odometer: 'Mileage', location: 'Location',
    receiver: 'Receiver', from: 'From', to: 'To',
    transfer_type_label: 'Transfer Type', conditions: 'Conditions',
    fuel: 'Fuel', battery: 'Battery',
    condition_header: 'Condition', equipment_header: 'Equipment',
    clean: 'Clean', dirty: 'Dirty', yes: 'Yes', no: 'No',
    carrier_sig: 'Carrier Handover', creator_sig_label: 'Accepted by (Inspector)',
    sig_creator: 'Inspector', sig_receiver: 'Receiver',
    no_photo: 'No Photo', damage_label: 'Damage',
    photo: { vorne: 'Front', hinten: 'Rear', links: 'Left', rechts: 'Right', schein: 'Reg. Doc.' },
    checklist: { floor: 'Floor', seats: 'Seats', entry: 'Entry', instruments: 'Dashboard',
                 trunk: 'Trunk', engine: 'Engine Bay', aid_kit: 'First Aid Kit',
                 triangle: 'Warning Triangle', vest: 'Vest', cable: 'Charging Cable',
                 registration: 'Registration', card: 'Charging Card' },
    damage_pos: 'Position', damage_type: 'Type', damage_intensity: 'Intensity', damage_desc: 'Description',
  },
}

// Module-level label context — set at start of generatePdf (safe: browser is single-threaded)
let _L: PdfLabels = PDF_LABELS.de
let _lang: 'de' | 'en' = 'de'

// Damage category translations (DE keys → EN display)
const DAMAGE_POSITIONS_EN: Record<string, string> = {
  // Top
  'Motorhaube': 'Bonnet',
  'Dach': 'Roof',
  'Spiegel links': 'Left mirror',
  'Spiegel rechts': 'Right mirror',
  // Front
  'Frontscheibe': 'Windscreen',
  'Scheinwerfer links': 'Left headlight',
  'Scheinwerfer rechts': 'Right headlight',
  'Stoßfänger vorne': 'Front bumper',
  'Kennzeichen vorne': 'Front licence plate',
  // Rear
  'Heckscheibe': 'Rear window',
  'Rückleuchte links': 'Left tail light',
  'Rückleuchte rechts': 'Right tail light',
  'Stoßfänger hinten': 'Rear bumper',
  'Kennzeichen hinten': 'Rear licence plate',
  // Left side
  'Kotflügel vorne links': 'Front left fender',
  'Tür vorne links': 'Front left door',
  'Tür hinten links': 'Rear left door',
  'Kotflügel hinten links': 'Rear left fender',
  'Seitenscheibe vorne links': 'Front left window',
  'Seitenscheibe hinten links': 'Rear left window',
  'Reifen vorne links': 'Front left tyre',
  'Felge vorne links': 'Front left rim',
  'Reifen hinten links': 'Rear left tyre',
  'Felge hinten links': 'Rear left rim',
  // Right side
  'Kotflügel vorne rechts': 'Front right fender',
  'Tür vorne rechts': 'Front right door',
  'Tür hinten rechts': 'Rear right door',
  'Kotflügel hinten rechts': 'Rear right fender',
  'Seitenscheibe vorne rechts': 'Front right window',
  'Seitenscheibe hinten rechts': 'Rear right window',
  'Reifen vorne rechts': 'Front right tyre',
  'Felge vorne rechts': 'Front right rim',
  'Reifen hinten rechts': 'Rear right tyre',
  'Felge hinten rechts': 'Rear right rim',
  // Interior
  'Innenraum': 'Interior',
  // Legacy (kept for existing records)
  'Felge / Reifen vorne links': 'Front left wheel / tyre',
  'Felge / Reifen hinten links': 'Rear left wheel / tyre',
  'Felge / Reifen vorne rechts': 'Front right wheel / tyre',
  'Felge / Reifen hinten rechts': 'Rear right wheel / tyre',
}

const DAMAGE_TYPES_EN: Record<string, string> = {
  'Kratzer': 'Scratch',
  'Delle': 'Dent',
  'Riss': 'Crack',
  'Bruch': 'Break',
  'Abplatzer': 'Chip',
  'Steinschlag': 'Stone chip',
  'Fehlend': 'Missing',
}

const DAMAGE_INTENSITIES_EN: Record<string, string> = {
  'Oberflächlich': 'Surface',
  'Mittel': 'Medium',
  'Tief': 'Deep',
}

// ─────────────────────────────────────────────────────────────────────────────
// Units & coordinate helpers
// ─────────────────────────────────────────────────────────────────────────────
//  pdf-lib: origin bottom-left, y increases upward
//  Old app (FPDF): origin top-left, y increases downward
//  All input measurements are in mm; converted to pt at 72dpi.

const PT = 72 / 25.4           // points per mm  (~2.8346)
const A4H = 297                // A4 height in mm

function mm(v: number): number { return v * PT }
/** Convert a position "y mm from the top" + element height to pdf-lib y (bottom edge). */
function top(y_mm: number, h_mm = 0): number { return (A4H - y_mm - h_mm) * PT }

// ─────────────────────────────────────────────────────────────────────────────
// Colours (FPDF RGB → pdf-lib rgb)
// ─────────────────────────────────────────────────────────────────────────────
const C_RED    = rgb(219 / 255, 50 / 255, 62 / 255)
const C_DKGRAY = rgb(63 / 255, 63 / 255, 63 / 255)
const C_BLACK  = rgb(0, 0, 0)
const C_LBLUE  = rgb(0.15, 0.35, 0.8)
const C_LGREEN = rgb(0.08, 0.55, 0.28)
const C_LABEL  = rgb(0.38, 0.38, 0.38)
const C_CELL_BG = rgb(0.93, 0.93, 0.93)
const C_WMARK  = rgb(200 / 255, 200 / 255, 200 / 255)

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────
const ML = mm(10)          // left margin
const CW = mm(190)         // total content width
const C2 = mm(95)          // 2-column cell width
const C3A = mm(63)
const C3B = mm(63)
const C3C = mm(64)
const ROW8 = mm(8)         // standard cell height
const ROW7 = mm(7)         // checklist row height
const CONTENT_TOP = 45     // mm from top where page content starts

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfData {
  protocol_type: 'annahme' | 'transfer'
  status: 'draft' | 'final'
  inspector_name: string
  /** For annahme: Standort. For transfer: "Von → Nach". */
  location: string
  odometer: number
  fuel_level: number
  battery: number
  remarks: string
  inspection_date: string
  license_plate: string
  brand_model: string
  vin: string
  /** Supabase Storage public URLs keyed by photo role. */
  photos: Record<string, string>
  conditions: string[]
  damage_records: DamageItem[]
  /** Ohne Checkliste entfällt Abschnitt 3 */
  checkliste?: Checkliste
  /** For transfer protocols: name of the receiving party. */
  receiver_name?: string
  /** For transfer protocols: art der Überführung (e.g. Selbstfahrer). */
  transfer_type?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Image utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch image URL, scale to ≤maxPx, re-encode as JPEG. Returns null on failure. */
async function fetchJpeg(url: string, maxPx = 700, quality = 0.72): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    const bmp = await createImageBitmap(blob)
    const scale = bmp.width > maxPx ? maxPx / bmp.width : 1
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    return new Promise<Uint8Array | null>((resolve) => {
      canvas.toBlob(
        (b) => (b ? b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))) : resolve(null)),
        'image/jpeg',
        quality
      )
    })
  } catch {
    return null
  }
}

/** Fetch PNG bytes verbatim (used for signature). */
async function fetchPng(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return new Uint8Array(await r.arrayBuffer())
  } catch {
    return null
  }
}

/** Aspect-correct image dims: given a target width in mm, returns height in mm. */
function scaledH(img: PDFImage, widthMm: number): number {
  return (img.height / img.width) * widthMm
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing primitives
// ─────────────────────────────────────────────────────────────────────────────

interface Fonts { regular: PDFFont; bold: PDFFont; oblique: PDFFont }

/** Draws a labelled data cell with optional header-shading.
 *  cursorY is the TOP of the cell row (in pdf-lib pts). */
function drawCell(
  page: PDFPage,
  fonts: Fonts,
  x: number,
  cursorY: number,
  w: number,
  h: number,
  label: string,
  value: string,
  opts: { shade?: boolean; valueSize?: number } = {}
) {
  const yBottom = cursorY - h

  if (opts.shade) {
    page.drawRectangle({ x, y: yBottom, width: w, height: h, color: C_CELL_BG, borderWidth: 0 })
  }
  page.drawRectangle({ x, y: yBottom, width: w, height: h, borderColor: C_BLACK, borderWidth: 0.5 })

  if (label) {
    page.drawText(safe(label), {
      x: x + mm(1),
      y: cursorY - mm(3.2),
      size: 6.5,
      font: fonts.regular,
      color: C_LABEL,
    })
  }
  if (value) {
    page.drawText(safe(value), {
      x: x + mm(1),
      y: yBottom + mm(1.8),
      size: opts.valueSize ?? 9,
      font: fonts.regular,
      color: C_BLACK,
    })
  }
}

/** Draws a section heading and returns the new cursorY. */
function drawHeading(page: PDFPage, bold: PDFFont, cursorY: number, text: string): number {
  page.drawText(safe(text), { x: ML, y: cursorY - mm(5.5), size: 12, font: bold, color: C_BLACK })
  return cursorY - mm(8.5)
}

/** Guard against chars outside Latin-1 (pdf-lib WinAnsiEncoding). */
/** Text an Wortgrenzen auf eine Breite umbrechen (überlange Wörter werden hart getrennt) */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word
      while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
        // Wort zu lang: so viel wie passt in eine eigene Zeile
        let cut = w.length - 1
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--
        if (line) lines.push(line)
        lines.push(w.slice(0, cut))
        line = ''
        w = w.slice(cut)
      }
      const next = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next
      else {
        if (line) lines.push(line)
        line = w
      }
    }
    lines.push(line)
  }
  return lines.length ? lines : ['']
}

function safe(s: string | number | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/[\u0100-\uFFFF]/g, '?')
}

// ─────────────────────────────────────────────────────────────────────────────
// Header (repeats on every page)
// ─────────────────────────────────────────────────────────────────────────────

async function drawPageHeader(
  page: PDFPage,
  _pdfDoc: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage | null,
  data: PdfData,
  isFirstPage: boolean
) {
  // ── Logo ──────────────────────────────────────────────────────────────────
  if (logoImg) {
    const logoW = mm(22)
    const logoH = mm(scaledH(logoImg, 22))
    page.drawImage(logoImg, {
      x: mm(175),
      y: top(5, scaledH(logoImg, 22)),
      width: logoW,
      height: logoH,
    })
  }

  // ── Red bar left: x=0, y=150 from top, w=3mm, h=147mm ─────────────────────
  page.drawRectangle({
    x: 0,
    y: top(150, 147),   // = (297-150-147)*PT = 0
    width: mm(3),
    height: mm(147),
    color: C_RED,
    borderWidth: 0,
  })

  // ── Grey bar right: x=207, y=0 from top, w=3mm, h=100mm ──────────────────
  page.drawRectangle({
    x: mm(207),
    y: top(0, 100),     // = (297-100)*PT
    width: mm(3),
    height: mm(100),
    color: C_DKGRAY,
    borderWidth: 0,
  })

  // ── "perfection in motion" rotated 90° CCW, x=208, y=88 ──────────────────
  page.drawText('perfection in motion', {
    x: mm(206),
    y: top(100),
    size: 8.5,
    font: fonts.regular,
    color: C_DKGRAY,
    rotate: degrees(90),
  })

  // ── Page title (first page only) ─────────────────────────────────────────
  if (isFirstPage) {
    const title =
      data.protocol_type === 'annahme' ? _L.title_annahme : _L.title_transfer
    page.drawText(safe(title), {
      x: mm(35),
      y: top(12, 6),    // 6mm ≈ 17pt font height
      size: 16,
      font: fonts.bold,
      color: C_BLACK,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Watermark
// ─────────────────────────────────────────────────────────────────────────────

function drawWatermark(page: PDFPage, bold: PDFFont) {
  const text = _L.watermark
  const size = 52
  const textWidth = bold.widthOfTextAtSize(text, size)
  const angle = Math.PI / 4
  const cx = mm(105)
  const cy = mm(148)
  page.drawText(text, {
    x: cx - (textWidth / 2) * Math.cos(angle),
    y: cy - (textWidth / 2) * Math.sin(angle),
    size,
    font: bold,
    color: C_WMARK,
    rotate: degrees(45),
    opacity: 0.55,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 1 — content sections
// ─────────────────────────────────────────────────────────────────────────────

function drawSection1Basisdaten(
  page: PDFPage,
  fonts: Fonts,
  cursorY: number,
  data: PdfData
): number {
  cursorY = drawHeading(page, fonts.bold, cursorY, _L.section1)

  const [von, nach] = data.location.includes(' → ')
    ? data.location.split(' → ')
    : [data.location, '']

  if (data.protocol_type === 'annahme') {
    // 2×3 grid
    const rows: [string, string, string, string][] = [
      [_L.plate, data.license_plate,  _L.brand_model, data.brand_model],
      [_L.vin,   data.vin,            _L.creator,     data.inspector_name],
      [_L.odometer, `${data.odometer} km`, _L.location, data.location],
    ]
    for (const [l1, v1, l2, v2] of rows) {
      drawCell(page, fonts, ML,        cursorY, C2, ROW8, l1, v1)
      drawCell(page, fonts, ML + C2,   cursorY, C2, ROW8, l2, v2)
      cursorY -= ROW8
    }
  } else {
    // 2×2 + extra rows
    const rows: [string, string, string, string][] = [
      [_L.plate,       data.license_plate,    _L.vin,      data.vin],
      [_L.brand_model, data.brand_model,      _L.odometer, `${data.odometer} km`],
      [_L.creator,     data.inspector_name,   _L.receiver, data.receiver_name ?? ''],
      [_L.from,        von,                   _L.to,       nach],
    ]
    for (const [l1, v1, l2, v2] of rows) {
      drawCell(page, fonts, ML,        cursorY, C2, ROW8, l1, v1)
      drawCell(page, fonts, ML + C2,   cursorY, C2, ROW8, l2, v2)
      cursorY -= ROW8
    }
    if (data.transfer_type) {
      drawCell(page, fonts, ML, cursorY, CW, ROW8, _L.transfer_type_label, data.transfer_type)
      cursorY -= ROW8
    }
    drawCell(page, fonts, ML, cursorY, CW, ROW8, _L.conditions, data.conditions.join(', '))
    cursorY -= ROW8
  }

  return cursorY
}

function drawSection2Technik(
  page: PDFPage,
  fonts: Fonts,
  cursorY: number,
  data: PdfData
): number {
  cursorY -= mm(4)  // ln(4) gap
  cursorY = drawHeading(page, fonts.bold, cursorY, _L.section2)

  if (data.protocol_type === 'annahme') {
    drawCell(page, fonts, ML,        cursorY, C2, ROW8, _L.fuel,    `${data.fuel_level} %`)
    drawCell(page, fonts, ML + C2,   cursorY, C2, ROW8, _L.battery, `${data.battery} %`)
    cursorY -= ROW8
  } else {
    drawCell(page, fonts, ML,              cursorY, C3A, ROW8, _L.fuel,       `${data.fuel_level} %`)
    drawCell(page, fonts, ML + C3A,        cursorY, C3B, ROW8, _L.battery,    `${data.battery} %`)
    drawCell(page, fonts, ML + C3A + C3B,  cursorY, C3C, ROW8, _L.conditions, data.conditions.join(', '))
    cursorY -= ROW8
  }

  return cursorY
}

function drawSection3Checkliste(
  page: PDFPage,
  fonts: Fonts,
  cursorY: number,
  data: PdfData
): number {
  const cl = data.checkliste
  if (!cl) return cursorY

  cursorY -= mm(4)
  cursorY = drawHeading(page, fonts.bold, cursorY, _L.section3)

  const accentColor = data.protocol_type === 'annahme' ? C_LBLUE : C_LGREEN

  // Column headers
  const headerH = mm(5.5)
  page.drawRectangle({ x: ML, y: cursorY - headerH, width: C2, height: headerH, color: C_CELL_BG, borderWidth: 0 })
  page.drawRectangle({ x: ML, y: cursorY - headerH, width: C2, height: headerH, borderColor: C_BLACK, borderWidth: 0.5 })
  page.drawText(_L.condition_header, { x: ML + mm(1), y: cursorY - mm(4), size: 8, font: fonts.bold, color: C_BLACK })

  page.drawRectangle({ x: ML + C2, y: cursorY - headerH, width: C2, height: headerH, color: C_CELL_BG, borderWidth: 0 })
  page.drawRectangle({ x: ML + C2, y: cursorY - headerH, width: C2, height: headerH, borderColor: C_BLACK, borderWidth: 0.5 })
  page.drawText(_L.equipment_header, { x: ML + C2 + mm(1), y: cursorY - mm(4), size: 8, font: fonts.bold, color: C_BLACK })
  cursorY -= headerH

  // 6 rows
  type CheckRow = [string, boolean, string, boolean]
  const rows: CheckRow[] = [
    [_L.checklist.floor,       cl.floor,       _L.checklist.aid_kit,      cl.aid_kit],
    [_L.checklist.seats,       cl.seats,       _L.checklist.triangle,     cl.triangle],
    [_L.checklist.entry,       cl.entry,       _L.checklist.vest,         cl.vest],
    [_L.checklist.instruments, cl.instruments, _L.checklist.cable,        cl.cable],
    [_L.checklist.trunk,       cl.trunk,       _L.checklist.registration, cl.registration],
    [_L.checklist.engine,      cl.engine,      _L.checklist.card,         cl.card],
  ]

  for (const [leftLabel, leftVal, rightLabel, rightVal] of rows) {
    // Left cell (Clean/Dirty)
    drawCell(page, fonts, ML, cursorY, C2, ROW7, leftLabel, '')
    const leftText = leftVal ? _L.clean : _L.dirty
    const leftBadgeW = mm(18)
    page.drawRectangle({
      x: ML + C2 - leftBadgeW - mm(1),
      y: cursorY - ROW7 + mm(1),
      width: leftBadgeW,
      height: ROW7 - mm(2),
      color: leftVal ? rgb(0.85, 0.96, 0.88) : rgb(0.98, 0.92, 0.88),
      borderWidth: 0,
    })
    page.drawText(leftText, {
      x: ML + C2 - leftBadgeW - mm(1) + mm(1),
      y: cursorY - ROW7 + mm(2),
      size: 7.5,
      font: fonts.bold,
      color: leftVal ? rgb(0.1, 0.5, 0.2) : rgb(0.7, 0.25, 0.1),
    })

    // Right cell (Yes/No)
    drawCell(page, fonts, ML + C2, cursorY, C2, ROW7, rightLabel, '')
    const rightText = rightVal ? _L.yes : _L.no
    const rightBadgeW = mm(12)
    page.drawRectangle({
      x: ML + C2 + C2 - rightBadgeW - mm(1),
      y: cursorY - ROW7 + mm(1),
      width: rightBadgeW,
      height: ROW7 - mm(2),
      color: rightVal ? rgb(0.85, 0.96, 0.88) : rgb(0.94, 0.94, 0.94),
      borderWidth: 0,
    })
    page.drawText(rightText, {
      x: ML + C2 + C2 - rightBadgeW - mm(1) + mm(1.5),
      y: cursorY - ROW7 + mm(2),
      size: 7.5,
      font: fonts.bold,
      color: rightVal ? rgb(0.1, 0.5, 0.2) : C_LABEL,
    })

    void accentColor  // reference to avoid unused-var lint
    cursorY -= ROW7
  }

  return cursorY
}

function drawSection4Bemerkungen(
  page: PDFPage,
  fonts: Fonts,
  cursorY: number,
  data: PdfData
): number {
  if (!data.remarks.trim()) return cursorY

  cursorY -= mm(4)
  cursorY = drawHeading(page, fonts.bold, cursorY, _L.section4)

  // Umbruch nach Breite und an Zeilenumbrüchen, damit der Rahmen mitwächst
  const cellH = mm(8)
  const lines = wrapText(safe(data.remarks.trim()), fonts.regular, 9, CW - mm(2))
  const totalH = Math.max(cellH, mm(2) + lines.length * mm(4.5))
  page.drawRectangle({ x: ML, y: cursorY - totalH, width: CW, height: totalH, borderColor: C_BLACK, borderWidth: 0.5 })
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: ML + mm(1),
      y: cursorY - mm(5) - i * mm(4.5),
      size: 9,
      font: fonts.regular,
      color: C_BLACK,
    })
  })
  cursorY -= totalH

  return cursorY
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature block
// ─────────────────────────────────────────────────────────────────────────────

async function drawSignatures(
  page: PDFPage,
  pdfDoc: PDFDocument,
  fonts: Fonts,
  data: PdfData,
  sigImg: PDFImage | null,
  sigImgReceiver: PDFImage | null = null,
  sigImgCarrier: PDFImage | null = null
) {
  const dateLang = _lang === 'en' ? 'en-GB' : 'de-DE'
  const dateStr = data.inspection_date
    ? new Date(data.inspection_date).toLocaleDateString(dateLang)
    : ''

  if (data.protocol_type === 'annahme') {
    const h = mm(30)
    const y = top(250, 30)

    function drawSigBox(x: number, w: number, label: string, name: string, img: PDFImage | null) {
      page.drawRectangle({ x, y, width: w, height: h, borderColor: C_BLACK, borderWidth: 0.5 })
      page.drawText(label, { x: x + mm(1), y: y + h - mm(4), size: 7, font: fonts.bold, color: C_BLACK })
      page.drawText(safe(name), { x: x + mm(1), y: y + mm(5.5), size: 8, font: fonts.regular, color: C_BLACK })
      page.drawText(dateStr, { x: x + mm(1), y: y + mm(2), size: 7, font: fonts.regular, color: C_LABEL })
      if (img) {
        const sigMaxW = w - mm(8)
        const sigMaxH = mm(18)
        const aspect = img.width / img.height
        const sigW = Math.min(sigMaxW, sigMaxH * aspect)
        const sigH = sigW / aspect
        page.drawImage(img, {
          x: x + (w - sigW) / 2,
          y: y + (h - sigH) / 2 - mm(1),
          width: sigW,
          height: sigH,
          opacity: 0.9,
        })
      }
    }

    if (sigImgCarrier) {
      drawSigBox(mm(85), mm(55), _L.carrier_sig, '', sigImgCarrier)
      drawSigBox(mm(145), mm(55), _L.creator_sig_label, data.inspector_name, sigImg)
    } else {
      drawSigBox(mm(145), mm(55), _L.creator_sig_label, data.inspector_name, sigImg)
    }
  } else {
    // Überführung: 2 columns, absolute y=250 from top, each 87mm wide
    const sigYTop = 245   // mm from top
    const sigH = mm(30)
    const sigY = top(sigYTop, 30)

    const cols = [
      { x: mm(10),  label: _L.sig_creator, name: data.inspector_name, img: sigImg },
      { x: mm(108), label: _L.sig_receiver, name: data.receiver_name ?? '', img: sigImgReceiver },
    ]

    for (const col of cols) {
      const w = mm(87)
      const boxW = mm(75)
      const boxH = mm(25)
      const boxX = col.x + (w - boxW) / 2

      page.drawRectangle({ x: col.x, y: sigY, width: w, height: sigH, borderColor: C_BLACK, borderWidth: 0.5 })
      page.drawText(col.label, {
        x: col.x + mm(1), y: sigY + sigH - mm(4.5), size: 7, font: fonts.bold, color: C_BLACK,
      })

      // Signature box
      page.drawRectangle({ x: boxX, y: sigY + mm(4), width: boxW, height: boxH, borderColor: C_BLACK, borderWidth: 0.4 })

      if (col.name) {
        page.drawText(safe(col.name), {
          x: col.x + mm(1), y: sigY + mm(2), size: 8, font: fonts.regular, color: C_BLACK,
        })
      }
      if (col.img) {
        const aspect = col.img.width / col.img.height
        const imgW = Math.min(boxW - mm(4), (boxH - mm(4)) * aspect)
        const imgH = imgW / aspect
        page.drawImage(col.img, {
          x: boxX + (boxW - imgW) / 2,
          y: sigY + mm(4) + (boxH - imgH) / 2,
          width: imgW,
          height: imgH,
          opacity: 0.9,
        })
      }
    }
    void pdfDoc  // suppress unused-var
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 2 — Photo documentation
// ─────────────────────────────────────────────────────────────────────────────

async function buildPhotoPage(
  pdfDoc: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage | null,
  data: PdfData,
  vehiclePhotoImgs: Partial<Record<string, PDFImage>>
) {
  const page = pdfDoc.addPage([mm(210), mm(297)])
  await drawPageHeader(page, pdfDoc, fonts, logoImg, data, false)

  let cursorY = top(CONTENT_TOP)
  cursorY = drawHeading(page, fonts.bold, cursorY, _L.section5)

  // 5 photos: 2-column layout
  // col x positions: 10mm and 108mm; each 87mm wide
  // Portrait: max h=95mm; Landscape: max h=58mm
  type PhotoSlot = { key: keyof typeof _L.photo; col: 0 | 1; maxHMm: number }
  const slots: PhotoSlot[] = [
    { key: 'vorne',  col: 0, maxHMm: 95 },
    { key: 'hinten', col: 1, maxHMm: 95 },
    { key: 'links',  col: 0, maxHMm: 58 },
    { key: 'rechts', col: 1, maxHMm: 58 },
    { key: 'schein', col: 1, maxHMm: 58 },
  ]

  const colX = [mm(10), mm(108)]
  const colW = mm(87)
  const labelH = mm(6)

  // Track row bottoms per column so we know where to place next image
  const rowBot = [cursorY, cursorY]   // top of current row for each column

  // Row boundaries: row 0 = portrait (95mm), row 1 = landscape (58mm), row 2 = landscape (58mm)
  const rowMaxH = [mm(95), mm(58), mm(58)]
  const rowAssignment = [0, 0, 1, 1, 2] // slot index → row index

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const img = vehiclePhotoImgs[slot.key]
    const row = rowAssignment[i]
    const colIdx = slot.col
    const x = colX[colIdx]
    const maxH = rowMaxH[row] - labelH
    const y = rowBot[colIdx] - rowMaxH[row]

    if (img) {
      // Scale to fit colW × maxH
      const aspect = img.width / img.height
      let imgW = colW
      let imgH = imgW / aspect
      if (imgH > maxH) { imgH = maxH; imgW = imgH * aspect }
      if (imgW > colW) { imgW = colW; imgH = imgW / aspect }

      page.drawImage(img, {
        x: x + (colW - imgW) / 2,
        y: y + labelH + (maxH - imgH) / 2,
        width: imgW,
        height: imgH,
      })
    } else {
      // Placeholder box
      page.drawRectangle({ x, y: y + labelH, width: colW, height: maxH, borderColor: C_CELL_BG, borderWidth: 0.5 })
      page.drawText(_L.no_photo, {
        x: x + colW / 2 - mm(8), y: y + labelH + maxH / 2 - mm(2),
        size: 8, font: fonts.regular, color: C_CELL_BG,
      })
    }

    // Label below image
    page.drawText(_L.photo[slot.key], {
      x: x + mm(1), y: y + mm(1.5),
      size: 7.5, font: fonts.oblique, color: C_LABEL,
    })

    // Advance column cursor after last slot in each row per column
    rowBot[colIdx] = y
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 3+ — Damage records
// ─────────────────────────────────────────────────────────────────────────────

async function buildDamagePages(
  pdfDoc: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage | null,
  data: PdfData,
  damagePhotoImgs: Record<string, PDFImage>
): Promise<PageEnd | null> {
  if (data.damage_records.length === 0 && Object.keys(damagePhotoImgs).length === 0) return null

  const page = pdfDoc.addPage([mm(210), mm(297)])
  await drawPageHeader(page, pdfDoc, fonts, logoImg, data, false)

  let cursorY = top(CONTENT_TOP)
  cursorY = drawHeading(page, fonts.bold, cursorY, _L.section6)

  // Table header (Freitext: eine breite Spalte statt Art + Intensität)
  const withDesc = data.damage_records.some((d) => d.desc !== undefined)
  const cols = withDesc ? [mm(12), mm(58), mm(120)] : [mm(12), mm(58), mm(55), mm(65)]
  const headers = withDesc
    ? ['#', _L.damage_pos, _L.damage_desc]
    : ['#', _L.damage_pos, _L.damage_type, _L.damage_intensity]
  let xOff = ML
  for (let i = 0; i < cols.length; i++) {
    page.drawRectangle({ x: xOff, y: cursorY - ROW7, width: cols[i], height: ROW7, color: C_CELL_BG, borderWidth: 0 })
    page.drawRectangle({ x: xOff, y: cursorY - ROW7, width: cols[i], height: ROW7, borderColor: C_BLACK, borderWidth: 0.5 })
    page.drawText(headers[i], { x: xOff + mm(1), y: cursorY - mm(5), size: 8, font: fonts.bold, color: C_BLACK })
    xOff += cols[i]
  }
  cursorY -= ROW7

  // Table rows
  for (let idx = 0; idx < data.damage_records.length; idx++) {
    const d = data.damage_records[idx]
    const isEn = _lang === 'en'
    const pos = isEn ? (DAMAGE_POSITIONS_EN[d.pos] ?? d.pos) : d.pos
    const type = d.type ?? ''
    const int = d.int ?? ''
    const values = withDesc
      ? [`${idx + 1}`, pos, d.desc ?? '']
      : [`${idx + 1}`, pos, isEn ? (DAMAGE_TYPES_EN[type] ?? type) : type, isEn ? (DAMAGE_INTENSITIES_EN[int] ?? int) : int]
    // Zellen umbrechen; die Zeile wächst mit der längsten Zelle
    const cellLines = values.map((v, i) => wrapText(safe(v), fonts.regular, 8, cols[i] - mm(2)))
    const rowH = Math.max(ROW7, mm(2.5) + Math.max(...cellLines.map((l) => l.length)) * mm(3.8))
    xOff = ML
    for (let i = 0; i < cols.length; i++) {
      page.drawRectangle({ x: xOff, y: cursorY - rowH, width: cols[i], height: rowH, borderColor: C_BLACK, borderWidth: 0.5 })
      cellLines[i].forEach((line, li) => {
        page.drawText(line, { x: xOff + mm(1), y: cursorY - mm(5) - li * mm(3.8), size: 8, font: fonts.regular, color: C_BLACK })
      })
      xOff += cols[i]
    }
    cursorY -= rowH
  }

  // Damage photos: 2-column layout
  if (Object.keys(damagePhotoImgs).length > 0) {
    cursorY -= mm(4)
    const colX = [mm(10), mm(108)]
    const colW = mm(87)
    const maxH = mm(60)
    const labelH = mm(6)
    let col = 0
    let rowY = cursorY

    // Start new page if not enough space
    const minSpace = maxH + labelH + mm(10)
    let currentPage = page
    if (cursorY - minSpace < mm(20)) {
      currentPage = pdfDoc.addPage([mm(210), mm(297)])
      await drawPageHeader(currentPage, pdfDoc, fonts, logoImg, data, false)
      rowY = top(CONTENT_TOP)
    }

    // Match photos to damage records by index.
    // Current format: schaden_0, schaden_1, …
    // Legacy format:  schaden_d_0, schaden_d_1, …
    // Fallback: remaining schaden_ keys in storage order (old timestamp-key format)
    const damageKeys: (string | null)[] = data.damage_records.map((_, i) => {
      if (damagePhotoImgs[`schaden_${i}`]) return `schaden_${i}`
      if (damagePhotoImgs[`schaden_d_${i}`]) return `schaden_d_${i}`
      return null
    })
    const matchedSet = new Set(damageKeys.filter((k): k is string => k !== null))
    const extraKeys = Object.keys(damagePhotoImgs).filter((k) => !matchedSet.has(k))
    const allDamageKeys: (string | null)[] = [...damageKeys, ...extraKeys]

    for (let di = 0; di < allDamageKeys.length; di++) {
      const key = allDamageKeys[di]
      if (!key) continue
      const img = damagePhotoImgs[key]
      if (!img) continue

      if (col === 0 && di > 0) {
        // Check if we need a new page (after filling both columns)
        if (rowY - maxH - labelH < mm(20)) {
          currentPage = pdfDoc.addPage([mm(210), mm(297)])
          await drawPageHeader(currentPage, pdfDoc, fonts, logoImg, data, false)
          rowY = top(CONTENT_TOP)
          col = 0
        }
      }

      const x = colX[col]
      const y = rowY - maxH - labelH
      const aspect = img.width / img.height
      let imgW = colW
      let imgH = imgW / aspect
      if (imgH > maxH) { imgH = maxH; imgW = imgH * aspect }

      currentPage.drawImage(img, {
        x: x + (colW - imgW) / 2,
        y: y + labelH + (maxH - imgH) / 2,
        width: imgW,
        height: imgH,
      })

      // Label: "Damage #N" or damage position
      const dmgIdx = data.damage_records[di]
      const labelText = dmgIdx
        ? `${_L.damage_label} ${di + 1}: ${safe(dmgIdx.pos)}`
        : `${_L.damage_label} ${di + 1}`
      currentPage.drawText(labelText, {
        x: x + mm(1), y: y + mm(1.5),
        size: 7.5, font: fonts.oblique, color: C_LABEL,
      })

      col++
      if (col === 2) {
        col = 0
        rowY -= maxH + labelH + mm(2)
      }
    }
    if (col !== 0) rowY -= maxH + labelH + mm(2)
    return { page: currentPage, cursorY: rowY }
  }

  return { page, cursorY }
}

// ─────────────────────────────────────────────────────────────────────────────
// After the damages — additional photos (zusatz_0, zusatz_1, …)
// ─────────────────────────────────────────────────────────────────────────────

/** Where the previous section stopped, so the next one can continue there. */
interface PageEnd { page: PDFPage; cursorY: number }

async function buildExtraPhotoPages(
  pdfDoc: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage | null,
  data: PdfData,
  extraImgs: PDFImage[],
  after: PageEnd | null
) {
  if (extraImgs.length === 0) return

  const colX = [mm(10), mm(108)]
  const colW = mm(87)
  const maxH = mm(68)   // three rows per page
  const labelH = mm(6)
  const rowH = maxH + labelH + mm(2)
  const bottom = mm(12)

  async function newPage(): Promise<PageEnd> {
    const p = pdfDoc.addPage([mm(210), mm(297)])
    await drawPageHeader(p, pdfDoc, fonts, logoImg, data, false)
    return { page: p, cursorY: top(CONTENT_TOP) }
  }

  // Continue below the damages if the heading and a first row still fit,
  // otherwise start a fresh page.
  let { page, cursorY } = after && after.cursorY - mm(13) - rowH >= bottom
    ? { page: after.page, cursorY: after.cursorY - mm(4) }
    : await newPage()
  cursorY = drawHeading(page, fonts.bold, cursorY, _L.section7)

  for (let i = 0; i < extraImgs.length; i++) {
    const col = i % 2
    if (col === 0 && i > 0) cursorY -= rowH
    if (col === 0 && cursorY - rowH < bottom) {
      ({ page, cursorY } = await newPage())
    }

    const img = extraImgs[i]
    const x = colX[col]
    const y = cursorY - maxH - labelH
    const aspect = img.width / img.height
    let imgW = colW
    let imgH = imgW / aspect
    if (imgH > maxH) { imgH = maxH; imgW = imgH * aspect }

    page.drawImage(img, {
      x: x + (colW - imgW) / 2,
      y: y + labelH + (maxH - imgH) / 2,
      width: imgW,
      height: imgH,
    })
    page.drawText(`${_L.extra_photo} ${i + 1}`, {
      x: x + mm(1), y: y + mm(1.5),
      size: 7.5, font: fonts.oblique, color: C_LABEL,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfOptions {
  /** URL des Logos oben rechts (PNG). Standard: '/carhandling.png' */
  logoUrl?: string
  /** Park & Fly: einzelne Beschriftungen überschreiben (z. B. Übergabe an den Kunden) */
  labels?: Partial<PdfLabels>
}

export async function generatePdf(
  data: PdfData,
  lang: 'de' | 'en' = 'de',
  { logoUrl = '/carhandling.png', labels }: PdfOptions = {}
): Promise<Uint8Array> {
  _lang = lang
  _L = labels ? { ...PDF_LABELS[lang], ...labels } : PDF_LABELS[lang]
  const pdfDoc = await PDFDocument.create()
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
  const fonts: Fonts = { regular, bold, oblique }

  // ── Load logo ───────────────────────────────────────────────────────────────
  let logoImg: PDFImage | null = null
  try {
    const logoResp = await fetch(logoUrl)
    if (logoResp.ok) {
      const logoBytes = new Uint8Array(await logoResp.arrayBuffer())
      logoImg = await pdfDoc.embedPng(logoBytes)
    }
  } catch { /* logo is optional */ }

  // ── Load & embed vehicle photos ─────────────────────────────────────────────
  const photoKeys = ['vorne', 'hinten', 'links', 'rechts', 'schein']
  const vehiclePhotoImgs: Partial<Record<string, PDFImage>> = {}
  await Promise.all(
    photoKeys.map(async (k) => {
      const url = data.photos[k]
      if (!url) return
      const bytes = await fetchJpeg(url)
      if (bytes) vehiclePhotoImgs[k] = await pdfDoc.embedJpg(bytes)
    })
  )

  // ── Load signature(s) ───────────────────────────────────────────────────────
  let sigImg: PDFImage | null = null
  const sigUrl = data.photos['signature']
  if (sigUrl) {
    const sigBytes = await fetchPng(sigUrl)
    if (sigBytes) sigImg = await pdfDoc.embedPng(sigBytes)
  }

  let sigImgReceiver: PDFImage | null = null
  const sigReceiverUrl = data.photos['signature_receiver']
  if (sigReceiverUrl) {
    const sigReceiverBytes = await fetchPng(sigReceiverUrl)
    if (sigReceiverBytes) sigImgReceiver = await pdfDoc.embedPng(sigReceiverBytes)
  }

  let sigImgCarrier: PDFImage | null = null
  const sigCarrierUrl = data.photos['signature_carrier']
  if (sigCarrierUrl) {
    const sigCarrierBytes = await fetchPng(sigCarrierUrl)
    if (sigCarrierBytes) sigImgCarrier = await pdfDoc.embedPng(sigCarrierBytes)
  }

  // ── Load damage photos ──────────────────────────────────────────────────────
  const damagePhotoImgs: Record<string, PDFImage> = {}
  const damagePhotoEntries = Object.entries(data.photos).filter(([k]) => k.startsWith('schaden_'))
  await Promise.all(
    damagePhotoEntries.map(async ([k, url]) => {
      const bytes = await fetchJpeg(url)
      if (bytes) damagePhotoImgs[k] = await pdfDoc.embedJpg(bytes)
    })
  )

  // ── Load additional photos (in order; failed downloads are skipped) ─────────
  const extraImgs = (await Promise.all(
    extraPhotoEntries(data.photos).map(async ([, url]) => {
      const bytes = await fetchJpeg(url, 900)
      return bytes ? pdfDoc.embedJpg(bytes) : null
    })
  )).filter((img): img is PDFImage => img !== null)

  // ── Page 1 ──────────────────────────────────────────────────────────────────
  const page1 = pdfDoc.addPage([mm(210), mm(297)])
  await drawPageHeader(page1, pdfDoc, fonts, logoImg, data, true)

  let cursorY = top(CONTENT_TOP)
  cursorY = drawSection1Basisdaten(page1, fonts, cursorY, data)
  cursorY = drawSection2Technik(page1, fonts, cursorY, data)
  cursorY = drawSection3Checkliste(page1, fonts, cursorY, data)
  cursorY = drawSection4Bemerkungen(page1, fonts, cursorY, data)
  void cursorY

  await drawSignatures(page1, pdfDoc, fonts, data, sigImg, sigImgReceiver, sigImgCarrier)

  // ── Page 2: Photos ──────────────────────────────────────────────────────────
  await buildPhotoPage(pdfDoc, fonts, logoImg, data, vehiclePhotoImgs)

  // ── Page 3+: Damages ────────────────────────────────────────────────────────
  const damageEnd = await buildDamagePages(pdfDoc, fonts, logoImg, data, damagePhotoImgs)

  // ── After the damages: additional photos ────────────────────────────────────
  await buildExtraPhotoPages(pdfDoc, fonts, logoImg, data, extraImgs, damageEnd)

  // ── Draft watermark on all pages ────────────────────────────────────────────
  if (data.status === 'draft') {
    for (const page of pdfDoc.getPages()) {
      drawWatermark(page, bold)
    }
  }

  return pdfDoc.save()
}
