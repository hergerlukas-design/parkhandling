import { describe, expect, it } from 'vitest'
import {
  base64UrlDecode,
  base64UrlEncode,
  buildPushRequest,
  createVapidJwt,
  deriveContentKeys,
  encryptPayload,
  generateVapidKeys,
} from '../../../supabase/functions/_shared/webpush.ts'

/** Simuliertes Gerät (User Agent): Schlüsselpaar + Auth-Secret wie bei PushManager.subscribe(). */
async function fakeDevice() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { pair, p256dh: base64UrlEncode(pub), auth: base64UrlEncode(auth), pub, authBytes: auth }
}

/** Entschlüsselt wie der Browser (RFC 8291/8188), um den Sender zu prüfen. */
async function decrypt(body: Uint8Array<ArrayBuffer>, device: Awaited<ReturnType<typeof fakeDevice>>) {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, device.pair.privateKey, 256))
  const { cek, nonce } = await deriveContentKeys(ecdh, device.authBytes, device.pub, asPublic, salt)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext))
  return { rs, idlen, delimiter: plain[plain.length - 1], text: new TextDecoder().decode(plain.slice(0, -1)) }
}

describe('base64url', () => {
  it('kodiert ohne Padding und dekodiert zurück', () => {
    const bytes = new Uint8Array([251, 255, 0, 1, 2])
    const encoded = base64UrlEncode(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(Array.from(base64UrlDecode(encoded))).toEqual(Array.from(bytes))
  })
})

describe('encryptPayload (RFC 8291)', () => {
  it('lässt sich vom Gerät entschlüsseln', async () => {
    const device = await fakeDevice()
    const message = JSON.stringify({ title: 'Neue Buchung M-MM 3839', body: 'Ankunft 23.10. 12:00' })
    const body = await encryptPayload(new TextEncoder().encode(message), device)
    const result = await decrypt(body, device)
    expect(result.rs).toBe(4096)
    expect(result.idlen).toBe(65)
    expect(result.delimiter).toBe(2)
    expect(result.text).toBe(message)
  })

  it('nutzt jedes Mal neue Schlüssel und Salt', async () => {
    const device = await fakeDevice()
    const payload = new TextEncoder().encode('gleich')
    const a = await encryptPayload(payload, device)
    const b = await encryptPayload(payload, device)
    expect(base64UrlEncode(a)).not.toBe(base64UrlEncode(b))
  })

  it('lehnt ungültige Geräteschlüssel und zu große Nachrichten ab', async () => {
    const device = await fakeDevice()
    await expect(encryptPayload(new Uint8Array(1), { p256dh: 'AAAA', auth: device.auth })).rejects.toThrow('p256dh')
    await expect(encryptPayload(new Uint8Array(4000), device)).rejects.toThrow('zu groß')
  })
})

describe('VAPID (RFC 8292)', () => {
  it('signiert ein JWT, das sich mit dem Public Key prüfen lässt', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:test@example.com' }
    const jwt = await createVapidJwt('https://fcm.googleapis.com/fcm/send/abc', keys, 1_000_000)
    const [h, c, s] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(c)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_000_000 + 12 * 3600,
      sub: 'mailto:test@example.com',
    })
    const pub = await crypto.subtle.importKey(
      'raw', base64UrlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    )
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, pub, base64UrlDecode(s), new TextEncoder().encode(`${h}.${c}`),
    )
    expect(ok).toBe(true)
  })

  it('baut den Request mit allen nötigen Headern', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:test@example.com' }
    const device = await fakeDevice()
    const req = await buildPushRequest(
      { endpoint: 'https://web.push.apple.com/xyz', p256dh: device.p256dh, auth: device.auth },
      { title: 'Test' },
      keys,
    )
    expect(req.headers['Content-Encoding']).toBe('aes128gcm')
    expect(req.headers.Authorization).toMatch(new RegExp(`^vapid t=[^,]+, k=${keys.publicKey}$`))
    expect(Number(req.headers.TTL)).toBeGreaterThan(0)
    expect((await decrypt(req.body, device)).text).toBe('{"title":"Test"}')
  })
})
