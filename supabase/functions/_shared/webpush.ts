// Web Push ohne Fremdbibliothek, nur WebCrypto (läuft in Deno/Edge Functions und im Browser/Node).
//  * Verschlüsselung der Nachricht nach RFC 8291 (Content-Encoding: aes128gcm, RFC 8188)
//  * Absender-Authentifizierung per VAPID nach RFC 8292 (JWT ES256)
// Wird von supabase/functions/push-send benutzt und in src/lib/push/webpush.test.ts getestet.

export interface PushSubscriptionKeys {
  endpoint: string
  /** öffentlicher Schlüssel des Geräts, base64url (65 Byte, unkomprimierter P-256-Punkt) */
  p256dh: string
  /** Auth-Secret des Geräts, base64url (16 Byte) */
  auth: string
}

export interface VapidKeys {
  /** base64url, 65 Byte (unkomprimierter P-256-Punkt) */
  publicKey: string
  /** base64url, 32 Byte (privater Skalar d) */
  privateKey: string
  /** Kontakt für den Push-Dienst, z. B. "mailto:betrieb@example.com" */
  subject: string
}

export interface PushRequest {
  endpoint: string
  headers: Record<string, string>
  body: Uint8Array<ArrayBuffer>
}

const enc = new TextEncoder()

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)
  return new Uint8Array(bits)
}

/** Schlüsselableitung nach RFC 8291 Abschnitt 3.4 (gemeinsam für Sender und Test-Empfänger). */
export async function deriveContentKeys(
  ecdhSecret: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
  uaPublic: Uint8Array<ArrayBuffer>,
  asPublic: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ cek: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> }> {
  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  return { cek, nonce }
}

export interface EncryptOptions {
  /** nur für Tests: fester Salt (16 Byte) */
  salt?: Uint8Array<ArrayBuffer>
  /** nur für Tests: festes Absender-Schlüsselpaar */
  senderKeys?: CryptoKeyPair
}

/** Verschlüsselt eine Nachricht für ein Gerät (ein einziger Record, aes128gcm). */
export async function encryptPayload(
  payload: Uint8Array<ArrayBuffer>,
  sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlDecode(sub.p256dh)
  const authSecret = base64UrlDecode(sub.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh ungültig')
  if (authSecret.length < 16) throw new Error('auth ungültig')
  // 4096 Byte Record − 16 Byte Tag − 1 Byte Trenner; Push-Dienste erlauben max. 4096 Byte gesamt
  if (payload.length > 3000) throw new Error('Nachricht zu groß')

  const senderKeys =
    options.senderKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeys.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, senderKeys.privateKey, 256),
  )
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const { cek, nonce } = await deriveContentKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plaintext = concatBytes(payload, new Uint8Array([2]))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext))

  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concatBytes(header, asPublic, ciphertext)
}

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = base64UrlDecode(keys.publicKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID Public Key ungültig')
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: base64UrlEncode(pub.subarray(1, 33)),
      y: base64UrlEncode(pub.subarray(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

/** VAPID-JWT für den Push-Dienst des Endpoints (gültig 12 h). */
export async function createVapidJwt(endpoint: string, keys: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = base64UrlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: keys.subject })),
  )
  const unsigned = `${header}.${claims}`
  const key = await importVapidPrivateKey(keys)
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)),
  )
  return `${unsigned}.${base64UrlEncode(signature)}`
}

/** Baut den vollständigen HTTP-Request für einen Push. */
export async function buildPushRequest(
  sub: PushSubscriptionKeys,
  payload: unknown,
  keys: VapidKeys,
  opts: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<PushRequest> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub)
  const jwt = await createVapidJwt(sub.endpoint, keys)
  return {
    endpoint: sub.endpoint,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: String(opts.ttlSeconds ?? 4 * 3600),
      Urgency: opts.urgency ?? 'high',
      Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
    },
    body,
  }
}

/** Erzeugt ein neues VAPID-Schlüsselpaar (base64url). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey: base64UrlEncode(publicKey), privateKey: jwk.d! }
}
