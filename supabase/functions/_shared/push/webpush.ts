/**
 * Web Push sender with WebCrypto + fetch only (no npm package): the `web-push` package relies on
 * Node APIs that crash in the Supabase Edge runtime. Implements RFC 8291 (aes128gcm payload
 * encryption) and RFC 8292 (VAPID). Runs the same in Deno, Node and the browser.
 */
export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export interface Vapid {
  subject: string
  publicKey: string
  privateKey: string
}

const enc = new TextEncoder()

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function bytesToB64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** Signed VAPID JWT for the push service of `endpoint` (valid 12 h). */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const pub = b64urlToBytes(vapid.publicKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY inválida')
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })))
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${bytesToB64url(signature)}, k=${vapid.publicKey}`
}

/** RFC 8291 body: salt(16) | record size(4) | key length(1) | sender public key(65) | ciphertext. */
export async function encryptPayload(target: Pick<PushTarget, 'p256dh' | 'auth'>, payload: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlToBytes(target.p256dh)
  const authSecret = b64urlToBytes(target.auth)
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, pair.privateKey, 256))

  const prkKey = await hmac(authSecret, ecdhSecret)
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // One record: the payload followed by the 0x02 "last record" delimiter, no padding.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(payload), new Uint8Array([2]))))
  const header = new Uint8Array(new ArrayBuffer(21))
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

export interface SendResult {
  status: number
  /** The subscription no longer exists (404/410): the caller should forget it. */
  gone: boolean
}

/** Sends one push. Throws on other failures (with the push service's status, never key material). */
export async function sendWebPush(target: PushTarget, payload: string, vapid: Vapid, opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {}): Promise<SendResult> {
  const body = await encryptPayload(target, payload)
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid),
      TTL: String(opts.ttl ?? 3600),
      Urgency: opts.urgency ?? 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  })
  await res.body?.cancel()
  if (res.status === 404 || res.status === 410) return { status: res.status, gone: true }
  if (!res.ok) throw new Error(`push service ${new URL(target.endpoint).host} respondeu ${res.status}`)
  return { status: res.status, gone: false }
}
