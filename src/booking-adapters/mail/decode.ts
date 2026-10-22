/**
 * Rohmail (RFC 822 / .eml, HTML oder eingefügter Text) → lesbarer Text.
 *
 * Bewusst ohne DOM- oder Node-APIs (nur TextDecoder, atob, RegExp), damit derselbe Code
 * im Browser (Import-Dialog) und in einer Supabase Edge Function (IMAP-Abruf, Deno) läuft.
 */

export interface DecodedMail {
  subject: string | null
  from: string | null
  /** ISO 8601, aus dem Date-Header */
  date: string | null
  /** Klartext, zeilenweise, Tabellenzellen durch Tabulator getrennt */
  text: string
  /** 'eml' = MIME-Mail, 'html' = eingefügtes HTML, 'text' = eingefügter Text */
  format: 'eml' | 'html' | 'text'
}

interface MimePart {
  headers: Record<string, string>
  body: string
}

// ---------------------------------------------------------------------------
// Zeichensätze und Kodierungen
// ---------------------------------------------------------------------------

function bytesFromBinaryString(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function decodeBytes(bytes: Uint8Array, charset: string | null | undefined): string {
  const cs = (charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '')
  try {
    return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function base64ToBinary(b64: string): string {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '')
  try {
    return atob(clean)
  } catch {
    return ''
  }
}

function quotedPrintableToBinary(qp: string): string {
  return qp
    .replace(/=\r?\n/g, '') // weiche Zeilenumbrüche
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/** RFC 2047: =?utf-8?Q?Reservierung_bei_Parkos?= und =?utf-8?B?...?= */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?') // Leerraum zwischen zwei kodierten Wörtern entfällt
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, charset: string, enc: string, data: string) => {
      const binary =
        enc.toUpperCase() === 'B' ? base64ToBinary(data) : quotedPrintableToBinary(data.replace(/_/g, ' '))
      return decodeBytes(bytesFromBinaryString(binary), charset)
    })
}

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

function splitHeaderBody(raw: string): { headerText: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw)
  if (!m) return { headerText: raw, body: '' }
  return { headerText: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) }
}

function parseHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    if (!(key in headers)) headers[key] = line.slice(idx + 1).trim()
  }
  return headers
}

function headerParam(value: string | undefined, name: string): string | null {
  if (!value) return null
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i').exec(value)
  return m ? (m[2] ?? m[1]) : null
}

function decodePartBody(part: MimePart): string {
  const enc = (part.headers['content-transfer-encoding'] ?? '').toLowerCase()
  const charset = headerParam(part.headers['content-type'], 'charset')
  let binary = part.body
  if (enc.includes('base64')) binary = base64ToBinary(part.body)
  else if (enc.includes('quoted-printable')) binary = quotedPrintableToBinary(part.body)
  // 7bit/8bit: Rohmail kommt bereits als JS-String; nur bei Binär-Kodierungen neu dekodieren
  if (enc.includes('base64') || enc.includes('quoted-printable')) {
    return decodeBytes(bytesFromBinaryString(binary), charset)
  }
  return binary
}

/** Alle Blatt-Teile einer MIME-Nachricht (rekursiv durch multipart/*). */
function leafParts(part: MimePart, depth = 0): MimePart[] {
  const type = (part.headers['content-type'] ?? 'text/plain').toLowerCase()
  if (!type.startsWith('multipart/') || depth > 10) return [part]
  const boundary = headerParam(part.headers['content-type'], 'boundary')
  if (!boundary) return [part]
  const chunks = part.body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`))
  return chunks
    .filter((c) => c.trim() && !/^\s*$/.test(c))
    .map((c) => {
      const { headerText, body } = splitHeaderBody(c)
      return { headers: parseHeaders(headerText), body }
    })
    .filter((p) => Object.keys(p.headers).length > 0)
    .flatMap((p) => leafParts(p, depth + 1))
}

/** Sieht der Text wie eine komplette Mail mit Kopfzeilen aus? */
export function looksLikeEml(raw: string): boolean {
  const head = raw.slice(0, 4000)
  return /^(?:[\w-]+:[^\n]*\r?\n(?:[ \t][^\n]*\r?\n)*)+/.test(head) && /^(from|subject|content-type|mime-version|received|return-path|date|delivered-to|message-id):/im.test(head)
}

// ---------------------------------------------------------------------------
// HTML → Text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ndash: '–', mdash: '—',
  hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', copy: '©', reg: '®',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? m
  })
}

/**
 * HTML in Klartext: Zeilen pro Absatz/Tabellenzeile, Zellen durch Tabulator getrennt.
 * Bilder, Stile und Skripte entfallen (es wird nur Text gespeichert).
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, '\t')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|tbody|thead|section|header|footer|blockquote)\s*>/gi, '\n')
    .replace(/<(p|div|tr|li|h[1-6]|table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  return normalizeText(s)
}

/** Leerraum je Zeile vereinheitlichen, leere Zeilen zusammenfassen. */
export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) =>
      line
        .split('\t')
        .map((cell) => cell.replace(/[ \f\v -​]+/g, ' ').trim())
        .filter(Boolean)
        .join('\t'),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

function parseDateHeader(value: string | undefined): string | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Rohmail beliebiger Form in Klartext + Kopfdaten umwandeln. */
export function decodeMail(raw: string): DecodedMail {
  const input = raw.replace(/^﻿/, '')
  if (looksLikeEml(input)) {
    const { headerText, body } = splitHeaderBody(input)
    const headers = parseHeaders(headerText)
    const parts = leafParts({ headers, body })
    const textParts = parts.filter((p) => !/^attachment/i.test(p.headers['content-disposition'] ?? ''))
    const html = textParts.find((p) => /text\/html/i.test(p.headers['content-type'] ?? ''))
    const plain = textParts.find((p) => /text\/plain/i.test(p.headers['content-type'] ?? 'text/plain'))
    const text = html ? htmlToText(decodePartBody(html)) : plain ? normalizeText(decodePartBody(plain)) : ''
    return {
      subject: headers.subject ? decodeEncodedWords(headers.subject) : null,
      from: headers.from ? decodeEncodedWords(headers.from) : null,
      date: parseDateHeader(headers.date),
      text,
      format: 'eml',
    }
  }
  if (/<(html|body|table|div|p|br|td)\b/i.test(input)) {
    return { subject: null, from: null, date: null, text: htmlToText(input), format: 'html' }
  }
  return { subject: null, from: null, date: null, text: normalizeText(input), format: 'text' }
}

/** E-Mail-Adresse aus einem From-Header ("Parkos <support@parkos.com>" → "support@parkos.com"). */
export function senderAddress(from: string | null): string | null {
  if (!from) return null
  const m = /<([^>]+)>/.exec(from) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(from)
  return m ? m[1].trim().toLowerCase() : null
}
