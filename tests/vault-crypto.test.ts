/**
 * PARTE 13: regressão criptográfica do Cofre (src/lib/vault.ts). Complementa vault-sync.test.ts com os casos
 * que faltavam: ciphertext/IV adulterado, nonce único, troca de senha, recuperação por código, limites de
 * iteração do PBKDF2 e isolamento entre cofres. Só Web Crypto; determinístico; nenhuma chamada externa.
 */
import { describe, expect, it } from 'vitest'
import {
  createVault, unlockWithPassword, changeVaultPassword, resetWithRecovery, seal, open,
  fromB64, toB64, WrongVaultSecretError, PBKDF2_ITERATIONS, MIN_ITERATIONS, MAX_ITERATIONS,
} from '../src/lib/vault'
import type { VaultMeta } from '../src/data/types'

const PW = 'senha-do-cofre-123'

describe('Cofre — criptografia autenticada (AES-GCM) [PARTE 13]', () => {
  it('seal/open faz round-trip e a senha errada falha com erro específico', async () => {
    const { meta, key } = await createVault(PW, false)
    const sealed = await seal(key, 'minha-senha-secreta')
    expect(sealed.ct).not.toContain('minha')
    expect(await open(key, sealed)).toBe('minha-senha-secreta')
    await expect(unlockWithPassword(meta, 'outra-senha-9999')).rejects.toBeInstanceOf(WrongVaultSecretError)
  })

  it('ciphertext adulterado é rejeitado (a tag GCM detecta a alteração)', async () => {
    const { key } = await createVault(PW, false)
    const sealed = await seal(key, 'valor-importante')
    const bytes = fromB64(sealed.ct)
    bytes[bytes.length - 1] ^= 0x01 // vira 1 bit do ciphertext/tag
    await expect(open(key, { ...sealed, ct: toB64(bytes) })).rejects.toThrow()
  })

  it('IV adulterado é rejeitado', async () => {
    const { key } = await createVault(PW, false)
    const sealed = await seal(key, 'valor')
    const iv = fromB64(sealed.iv)
    iv[0] ^= 0x01
    await expect(open(key, { ...sealed, iv: toB64(iv) })).rejects.toThrow()
  })

  it('o mesmo texto gera IV e ciphertext diferentes a cada seal (nonce único)', async () => {
    const { key } = await createVault(PW, false)
    const a = await seal(key, 'igual')
    const b = await seal(key, 'igual')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
    expect(await open(key, a)).toBe('igual')
    expect(await open(key, b)).toBe('igual')
  })

  it('PBKDF2: cofre usa SHA-256, 600k iterações e salt aleatório; a chave diária é não-extraível', async () => {
    const { meta, key } = await createVault(PW, false)
    expect(meta.kdf).toBe('PBKDF2-SHA256')
    expect(meta.byPassword.iterations).toBe(PBKDF2_ITERATIONS)
    expect(meta.byPassword.salt.length).toBeGreaterThan(0)
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
    // dois cofres com a MESMA senha têm salts diferentes → chaves embrulhadas diferentes
    const other = await createVault(PW, false)
    expect(other.meta.byPassword.salt).not.toBe(meta.byPassword.salt)
    expect(other.meta.byPassword.ct).not.toBe(meta.byPassword.ct)
  })

  it('iterações fora de [MIN, MAX] são recusadas (backup adulterado não congela nem enfraquece)', async () => {
    const { meta } = await createVault(PW, false)
    const low: VaultMeta = { ...meta, byPassword: { ...meta.byPassword, iterations: MIN_ITERATIONS - 1 } }
    const high: VaultMeta = { ...meta, byPassword: { ...meta.byPassword, iterations: MAX_ITERATIONS + 1 } }
    await expect(unlockWithPassword(low, PW)).rejects.toThrow()
    await expect(unlockWithPassword(high, PW)).rejects.toThrow()
  })

  it('trocar a senha: a antiga para de abrir, a nova abre, e o já selado continua legível', async () => {
    const { meta, key } = await createVault(PW, false)
    const sealed = await seal(key, 'cartao-1234')
    const next = 'nova-senha-do-cofre-1'
    const changed = await changeVaultPassword(meta, PW, next)
    await expect(unlockWithPassword(changed.meta, PW)).rejects.toBeInstanceOf(WrongVaultSecretError)
    const reopened = await unlockWithPassword(changed.meta, next)
    expect(await open(reopened, sealed)).toBe('cartao-1234') // mesma chave de dados preservada
  })

  it('recuperação por código: abre, define nova senha e mantém o que já estava selado', async () => {
    const { meta, key, recoveryCode } = await createVault(PW, true)
    expect(recoveryCode).toBeTruthy()
    const sealed = await seal(key, 'segredo-antigo')
    const reset = await resetWithRecovery(meta, recoveryCode!, 'senha-nova-9988')
    const openedKey = await unlockWithPassword(reset.meta, 'senha-nova-9988')
    expect(await open(openedKey, sealed)).toBe('segredo-antigo')
    await expect(unlockWithPassword(reset.meta, PW)).rejects.toBeInstanceOf(WrongVaultSecretError)
  })

  it('isolamento: a chave de um cofre não abre o ciphertext de outro', async () => {
    const v1 = await createVault(PW, false)
    const v2 = await createVault('senha-do-cofre-2-xyz', false)
    const sealed = await seal(v1.key, 'so-do-v1')
    await expect(open(v2.key, sealed)).rejects.toThrow()
  })
})
