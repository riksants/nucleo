/**
 * Vault for the passwords saved in "Senhas". Standard Web Crypto only:
 *
 * - A random 256-bit data key (AES-GCM) encrypts each password with a fresh 96-bit IV.
 * - The data key is stored only wrapped (encrypted) by a key derived from the
 *   vault password with PBKDF2-SHA256 (600 000 iterations, 16-byte random salt,
 *   OWASP 2023 recommendation). The derived key is never stored.
 * - Optionally the same data key is also wrapped by a random recovery code shown once.
 * - Unlocked, the data key lives only in memory as a non-extractable CryptoKey.
 *
 * Without the vault password or the recovery code the passwords cannot be
 * recovered by anyone, including the server.
 */
import type { SealedValue, VaultMeta, WrappedKey } from '../data/types'

export const PBKDF2_ITERATIONS = 600_000
const enc = new TextEncoder()
const dec = new TextDecoder()

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text)
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))
}

async function deriveKek(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

async function wrap(dataKey: CryptoKey, secret: string): Promise<WrappedKey> {
  const salt = random(16)
  const iv = random(12)
  const kek = await deriveKek(secret, salt, PBKDF2_ITERATIONS)
  const ct = await crypto.subtle.wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv })
  return { salt: toB64(salt), iterations: PBKDF2_ITERATIONS, iv: toB64(iv), ct: toB64(ct) }
}

export class WrongVaultSecretError extends Error {
  constructor() {
    super('Senha do cofre incorreta.')
  }
}

async function unwrap(w: WrappedKey, secret: string, extractable = false): Promise<CryptoKey> {
  const kek = await deriveKek(secret, fromB64(w.salt), w.iterations)
  try {
    return await crypto.subtle.unwrapKey('raw', fromB64(w.ct), kek, { name: 'AES-GCM', iv: fromB64(w.iv) }, { name: 'AES-GCM', length: 256 }, extractable, [
      'encrypt',
      'decrypt',
    ])
  } catch {
    // AES-GCM authentication failed: wrong secret (or tampered data).
    throw new WrongVaultSecretError()
  }
}

/** 32 base32 characters (160 bits) in groups of 4, e.g. "K7QF-…". */
export function makeRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = random(32)
  const chars = [...bytes].map((b) => alphabet[b % 32]).join('')
  return chars.match(/.{4}/g)!.join('-')
}

export function normalizeRecoveryCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.match(/.{1,4}/g)?.join('-') ?? ''
}

export const MIN_VAULT_PASSWORD = 10

export function vaultPasswordProblem(password: string): string | null {
  if (password.length < MIN_VAULT_PASSWORD) return `Use pelo menos ${MIN_VAULT_PASSWORD} caracteres.`
  if (/^(.)\1+$/.test(password)) return 'Escolha algo menos previsível.'
  return null
}

export async function createVault(password: string, withRecovery: boolean, autoLockMin = 5): Promise<{ meta: VaultMeta; key: CryptoKey; recoveryCode: string | null }> {
  const extractable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const recoveryCode = withRecovery ? makeRecoveryCode() : null
  const meta: VaultMeta = {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    byPassword: await wrap(extractable, password),
    byRecovery: recoveryCode ? await wrap(extractable, recoveryCode) : null,
    createdAt: new Date().toISOString(),
    autoLockMin,
  }
  // Re-import as non-extractable for day-to-day use.
  const key = await unwrap(meta.byPassword, password)
  return { meta, key, recoveryCode }
}

export function unlockWithPassword(meta: VaultMeta, password: string): Promise<CryptoKey> {
  return unwrap(meta.byPassword, password)
}

/** Recovery code → sets a new vault password (and keeps the same recovery code valid). */
export async function resetWithRecovery(meta: VaultMeta, code: string, newPassword: string): Promise<{ meta: VaultMeta; key: CryptoKey }> {
  if (!meta.byRecovery) throw new Error('Este cofre não tem código de recuperação.')
  const dataKey = await unwrap(meta.byRecovery, normalizeRecoveryCode(code), true)
  const next: VaultMeta = { ...meta, byPassword: await wrap(dataKey, newPassword) }
  return { meta: next, key: await unwrap(next.byPassword, newPassword) }
}

export async function changeVaultPassword(meta: VaultMeta, current: string, next: string): Promise<{ meta: VaultMeta; key: CryptoKey }> {
  const dataKey = await unwrap(meta.byPassword, current, true)
  const updated: VaultMeta = { ...meta, byPassword: await wrap(dataKey, next) }
  return { meta: updated, key: await unwrap(updated.byPassword, next) }
}

export async function seal(key: CryptoKey, plain: string): Promise<SealedValue> {
  const iv = random(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain))
  return { v: 1, iv: toB64(iv), ct: toB64(ct) }
}

export async function open(key: CryptoKey, sealed: SealedValue): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct))
  return dec.decode(plain)
}
