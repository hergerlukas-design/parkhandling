// Erzeugt ein VAPID-Schlüsselpaar für Web Push (P-256, base64url).
// Aufruf: npm run push:keys
//   Public Key  → settings.push_vapid_public_key und Secret VAPID_PUBLIC_KEY
//   Private Key → nur Secret VAPID_PRIVATE_KEY der Edge Function push-send (nie ins Repo!)
const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey)
const secret = b64url(crypto.getRandomValues(new Uint8Array(32)))

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log(`PUSH_SEND_SECRET=${secret}`)
