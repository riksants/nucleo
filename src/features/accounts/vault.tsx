import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../data/store'
import type { Account, SealedValue, VaultMeta } from '../../data/types'
import { changeVaultPassword, createVault, open, resetWithRecovery, seal, unlockWithPassword } from '../../lib/vault'

interface VaultApi {
  exists: boolean
  unlocked: boolean
  meta: VaultMeta | null
  /** Accounts still holding a plain-text password from before the vault existed. */
  plainCount: number
  create(password: string, withRecovery: boolean): Promise<{ recoveryCode: string | null; migrated: number }>
  /** Resolves with how many passwords from before the vault were protected (sealed and checked) on the way. */
  unlock(password: string): Promise<number>
  recover(code: string, newPassword: string): Promise<void>
  changePassword(current: string, next: string): Promise<void>
  setAutoLock(minutes: number): Promise<void>
  lock(): void
  reveal(sealed: SealedValue): Promise<string>
  sealText(plain: string): Promise<SealedValue>
  /** Encrypts a legacy plain password (used by migration and import). */
  sealAccount(account: Account): Promise<Account>
}

const VaultContext = createContext<VaultApi | null>(null)

export const AUTO_LOCK_OPTIONS = [1, 5, 15]

export function VaultProvider({ children }: { children: ReactNode }) {
  const { settings, data, updateSettings, save } = useStore()
  const meta = settings.vault ?? null
  const [key, setKey] = useState<CryptoKey | null>(null)
  const keyRef = useRef(key)
  keyRef.current = key
  const lastActivity = useRef(Date.now())

  const lock = useCallback(() => setKey(null), [])

  // Locks after N minutes without interaction, including time spent in the background.
  useEffect(() => {
    if (!key || !meta) return
    const limit = meta.autoLockMin * 60_000
    lastActivity.current = Date.now()
    const touch = () => {
      lastActivity.current = Date.now()
    }
    const check = () => {
      if (Date.now() - lastActivity.current >= limit) setKey(null)
    }
    const onVisible = () => document.visibilityState === 'visible' && check()
    const events = ['pointerdown', 'keydown', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(check, 10_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch))
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [key, meta])

  // Locks when leaving (logout remounts the provider; this covers closing the page).
  useEffect(() => {
    const onHide = () => setKey(null)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  const plainAccounts = useMemo(() => data.accounts.filter((a) => a.password), [data.accounts])

  const sealAccountWith = useCallback(async (k: CryptoKey, account: Account): Promise<Account> => {
    if (!account.password) return account
    const sealed = await seal(k, account.password)
    // Verify before dropping the plain text: never lose a password silently.
    if ((await open(k, sealed)) !== account.password) throw new Error(`Falha ao verificar a senha de “${account.name}”. Nada foi alterado.`)
    return { ...account, password: '', secret: sealed }
  }, [])

  /**
   * Moves passwords from before the vault into it, one account at a time: sealed, decrypted back and compared,
   * then saved; the saved record is checked again (sealed, no plain text). An account that fails keeps its
   * password as it was (nothing is deleted before its sealed copy is confirmed) and the error is reported.
   */
  const migrate = useCallback(
    async (k: CryptoKey, accounts: Account[]): Promise<number> => {
      let done = 0
      for (const account of accounts) {
        const sealed = await sealAccountWith(k, account)
        const saved = await save('accounts', sealed)
        if (saved.password || !saved.secret || (await open(k, saved.secret)) !== account.password) throw new Error(`Falha ao conferir a senha de “${account.name}” depois de salvar.`)
        done++
      }
      return done
    },
    [save, sealAccountWith],
  )

  const create = useCallback<VaultApi['create']>(
    async (password, withRecovery) => {
      if (meta) throw new Error('O cofre já existe.')
      const created = await createVault(password, withRecovery)
      await updateSettings({ vault: created.meta })
      setKey(created.key)
      const migrated = await migrate(created.key, plainAccounts)
      return { recoveryCode: created.recoveryCode, migrated }
    },
    [meta, updateSettings, plainAccounts, migrate],
  )

  const unlock = useCallback(
    async (password: string) => {
      if (!meta) throw new Error('Crie o cofre primeiro.')
      const k = await unlockWithPassword(meta, password)
      setKey(k)
      // Passwords that arrived in plain text (from before the vault, an old backup) are sealed on unlock.
      return migrate(k, plainAccounts)
    },
    [meta, plainAccounts, migrate],
  )

  const recover = useCallback(
    async (code: string, newPassword: string) => {
      if (!meta) throw new Error('Não há cofre.')
      const next = await resetWithRecovery(meta, code, newPassword)
      await updateSettings({ vault: next.meta })
      setKey(next.key)
    },
    [meta, updateSettings],
  )

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (!meta) throw new Error('Não há cofre.')
      const changed = await changeVaultPassword(meta, current, next)
      await updateSettings({ vault: changed.meta })
      setKey(changed.key)
    },
    [meta, updateSettings],
  )

  const setAutoLock = useCallback(
    async (minutes: number) => {
      if (meta) await updateSettings({ vault: { ...meta, autoLockMin: minutes } })
    },
    [meta, updateSettings],
  )

  const reveal = useCallback(async (sealed: SealedValue) => {
    const k = keyRef.current
    if (!k) throw new Error('Cofre bloqueado.')
    return open(k, sealed)
  }, [])

  const sealText = useCallback(async (plain: string) => {
    const k = keyRef.current
    if (!k) throw new Error('Cofre bloqueado.')
    return seal(k, plain)
  }, [])

  const sealAccount = useCallback(
    async (account: Account) => {
      if (!account.password) return account
      const k = keyRef.current
      if (!k) throw new Error('Desbloqueie o cofre para proteger as senhas antes de continuar.')
      return sealAccountWith(k, account)
    },
    [sealAccountWith],
  )

  const api: VaultApi = {
    exists: meta !== null,
    unlocked: key !== null,
    meta,
    plainCount: plainAccounts.length,
    create,
    unlock,
    recover,
    changePassword,
    setAutoLock,
    lock,
    reveal,
    sealText,
    sealAccount,
  }

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>
}

export function useVault(): VaultApi {
  const api = useContext(VaultContext)
  if (!api) throw new Error('useVault must be used inside VaultProvider')
  return api
}
