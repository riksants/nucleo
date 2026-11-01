/**
 * NÚCLEO IA — signed turn envelope.
 *
 * The server keeps NO conversation text. Between the steps of one question (model asks for a
 * lookup → app runs it → server continues) the turn state travels to the app and back, signed
 * with HMAC-SHA256 under a server-only secret. On the way back the server checks the signature,
 * the expiry and that the envelope's user is the user of the current login: a turn of account A
 * can never be continued by account B, and the app cannot change the model, step, spending,
 * history or pending lookups of a turn.
 *
 * WebCrypto only (same code in Deno and in Node tests).
 */

export interface TurnState {
  v: 1
  uid: string
  turnId: string
  route: 'rapida' | 'atenta' | 'profunda'
  model: 'haiku' | 'sonnet' | 'opus'
  effort: 'low' | 'medium' | 'high'
  /** Model calls already made in this turn. */
  step: number
  /** Real cost of this turn so far, micro-dollars. */
  spentMicros: number
  /** The escalation to the deeper model was already used. */
  escalated: boolean
  /** Messages that open the turn (history + question), to restart it on another model. */
  base: unknown[]
  /** The whole turn so far, append-only (thinking blocks passed back unchanged). */
  messages: unknown[]
  /** tool_use ids waiting for the app's results, with the tool name. */
  pending: { id: string; name: string }[]
  /** tool_results the server already wrote (lookups it refused), sent together with the app's. */
  pre: unknown[]
  /** Epoch ms. */
  exp: number
}

export const TURN_TTL_MS = 10 * 60 * 1000

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(b.length))
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

async function key(secret: string) {
  if (!secret || secret.length < 32) throw new Error('IA_TURN_SECRET ausente ou curto (mínimo 32 caracteres).')
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function sealTurn(state: TurnState, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(state)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

export type OpenResult = { ok: true; state: TurnState } | { ok: false; reason: 'format' | 'signature' | 'expired' | 'user' }

export async function openTurn(envelope: string, secret: string, uid: string, now = Date.now()): Promise<OpenResult> {
  const parts = envelope.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'format' }
  let valid = false
  try {
    valid = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(parts[1]), enc.encode(parts[0]))
  } catch {
    return { ok: false, reason: 'format' }
  }
  if (!valid) return { ok: false, reason: 'signature' }
  let state: TurnState
  try {
    state = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])))
  } catch {
    return { ok: false, reason: 'format' }
  }
  if (state.v !== 1) return { ok: false, reason: 'format' }
  if (state.exp < now) return { ok: false, reason: 'expired' }
  if (state.uid !== uid) return { ok: false, reason: 'user' }
  return { ok: true, state }
}
