import { describe, expect, it } from 'vitest'
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidAuthorization } from '../supabase/functions/_shared/push/webpush.ts'

const enc = new TextEncoder()
const concat = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0))
  let at = 0
  for (const x of p) (out.set(x, at), (at += x.length))
  return out
}
const hmac = async (key: Uint8Array, data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data as BufferSource))

/** Receiver side of RFC 8291 (what the browser does), to check the sender end to end. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array) {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))
  const as = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, ua.privateKey, 256))
  const ikm = await hmac(await hmac(auth, secret), concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, body.slice(21 + idlen)))
  expect(plain.at(-1)).toBe(2)
  return new TextDecoder().decode(plain.slice(0, -1))
}

describe('web push (RFC 8291 / 8292)', () => {
  it('o navegador consegue decifrar o lembrete, e cada envio usa chave e sal novos', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const target = { p256dh: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))), auth: bytesToB64url(auth) }
    const payload = JSON.stringify({ title: 'Núcleo', body: 'Hora de um hábito', url: '#/habits', key: 'habit:h1:2026-10-30T09:00:10' })
    const a = await encryptPayload(target, payload)
    const b = await encryptPayload(target, payload)
    expect(new DataView(a.buffer).getUint32(16)).toBe(4096)
    expect(a[20]).toBe(65)
    expect(await decrypt(a, ua, auth)).toBe(payload)
    expect(await decrypt(b, ua, auth)).toBe(payload)
    expect(bytesToB64url(a.slice(0, 16))).not.toBe(bytesToB64url(b.slice(0, 16)))
  })

  it('VAPID: JWT ES256 válido para o serviço de push do aparelho', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
    const now = Date.UTC(2026, 9, 30, 12)
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQ', { subject: 'mailto:supportnucleo@gmail.com', publicKey, privateKey: jwk.d! }, now)
    const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!
    expect(k).toBe(publicKey)
    const [h, c, s] = t.split('.')
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(c)))).toEqual({ aud: 'https://web.push.apple.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:supportnucleo@gmail.com' })
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlToBytes(s), enc.encode(`${h}.${c}`))).toBe(true)
  })
})
