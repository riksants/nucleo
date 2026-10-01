import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { readPref, writePref } from '../lib/prefs'
import { effectiveRates, fetchRates, makeConverter, RATES_MAX_AGE_MS, type Converter } from '../lib/rates'
import { createIndexedDbRepository, type Repository, type SyncStatus } from './repository'
import { balanceOf } from './selectors'
import {
  COLLECTION_NAMES,
  type Cents,
  type CollectionName,
  type Collections,
  type Currency,
  type DataState,
  type Entity,
  type ModuleId,
  type Settings,
  STARTER_CURRENCIES,
  type Transaction,
  type TransactionType,
} from './types'

const EMPTY_DATA = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []])) as unknown as DataState

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  baseCurrency: 'BRL',
  initialBalance: 0,
  startedAt: '',
  rates: null,
  manualRates: {},
  lastBackupAt: null,
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type Draft<T extends Entity> = Omit<T, keyof Entity> & Partial<Entity>

export class MissingRateError extends Error {
  constructor() {
    super('Sem cotação disponível para converter esta moeda.')
  }
}

interface Store {
  ready: boolean
  loadError: string | null
  retryLoad(): void
  repository: Repository
  syncStatus: SyncStatus | null
  data: DataState
  settings: Settings
  balance: Cents
  displayCurrency: Currency
  convert: Converter
  hasRates: boolean
  ratesLoading: boolean
  setDisplayCurrency(c: Currency): void
  save<K extends CollectionName>(collection: K, draft: Draft<Collections[K]>): Promise<Collections[K]>
  remove(collection: CollectionName, id: string): Promise<void>
  addTransaction(input: { type: Exclude<TransactionType, 'adjust'>; amount: Cents; currency: Currency; reason: string }): Promise<Transaction>
  updateTransaction(tx: Transaction, patch: { amount: Cents; currency: Currency; reason: string }): Promise<Transaction>
  adjustBalance(target: Cents): Promise<Transaction | null>
  updateSettings(patch: Partial<Settings>): Promise<void>
  completeOnboarding(baseCurrency: Currency, initialBalance: Cents, modules?: Partial<Record<ModuleId, boolean>>): Promise<void>
  refreshRates(): Promise<boolean>
  importData(data: Partial<DataState>, settings: Settings | null, mode: 'merge' | 'replace'): Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children, repository }: { children: ReactNode; repository?: Repository }) {
  const repo = useMemo(() => repository ?? createIndexedDbRepository(), [repository])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(() => repo.status?.() ?? null)
  const [data, setData] = useState<DataState>(EMPTY_DATA)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [displayPref, setDisplayPref] = useState<Currency | null>(() => readPref<Currency | null>('displayCurrency', null))
  const [ratesLoading, setRatesLoading] = useState(false)

  // Actions read the latest state through refs so they stay referentially stable.
  const dataRef = useRef(data)
  const settingsRef = useRef(settings)
  dataRef.current = data
  settingsRef.current = settings

  useEffect(() => {
    let alive = true
    setLoadError(null)
    repo
      .load()
      .then(({ data, settings }) => {
        if (!alive) return
        setData(data)
        if (settings) setSettings({ ...DEFAULT_SETTINGS, ...settings })
        setReady(true)
      })
      .catch((err) => {
        console.error('Falha ao carregar dados', err)
        if (alive) setLoadError(err instanceof Error ? err.message : String(err))
      })
    navigator.storage?.persist?.().catch(() => {})
    return () => {
      alive = false
    }
  }, [repo, attempt])

  // Signed in: reload from the local cache whenever the sync brings remote changes.
  useEffect(() => {
    if (!repo.subscribe) return
    return repo.subscribe((event) => {
      if (event.type === 'status') {
        setSyncStatus(repo.status?.() ?? null)
        return
      }
      repo.load().then(({ data, settings }) => {
        dataRef.current = data
        setData(data)
        if (settings) {
          const next = { ...DEFAULT_SETTINGS, ...settings }
          settingsRef.current = next
          setSettings(next)
        }
      })
    })
  }, [repo])

  const rates = useMemo(() => effectiveRates(settings), [settings])
  const convert = useMemo(() => makeConverter(rates), [rates])

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...patch, updatedAt: new Date().toISOString() }
      settingsRef.current = next
      setSettings(next)
      await repo.saveSettings(next)
    },
    [repo],
  )

  const refreshRates = useCallback(async () => {
    setRatesLoading(true)
    const fetched = await fetchRates()
    setRatesLoading(false)
    if (fetched) await updateSettings({ rates: fetched })
    return fetched !== null
  }, [updateSettings])

  useEffect(() => {
    if (!ready) return
    const stale = () => {
      const at = settingsRef.current.rates?.fetchedAt
      return !at || Date.now() - new Date(at).getTime() > RATES_MAX_AGE_MS
    }
    if (stale()) refreshRates()
    const onOnline = () => stale() && refreshRates()
    const onVisible = () => document.visibilityState === 'visible' && stale() && refreshRates()
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ready, refreshRates])

  // Viewing currency: saved with the account settings and remembered on the device.
  const displayCurrency = settings.displayCurrency ?? displayPref ?? settings.baseCurrency
  const setDisplayCurrency = useCallback(
    (c: Currency) => {
      setDisplayPref(c)
      writePref('displayCurrency', c)
      void updateSettings({ displayCurrency: c })
    },
    [updateSettings],
  )

  const save = useCallback(
    async <K extends CollectionName>(collection: K, draft: Draft<Collections[K]>) => {
      const now = new Date().toISOString()
      const item = { ...draft, id: draft.id ?? newId(), createdAt: draft.createdAt ?? now, updatedAt: now } as Collections[K]
      setData((prev) => {
        const list = prev[collection] as Collections[K][]
        const exists = list.some((x) => x.id === item.id)
        const nextList = exists ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]
        const next = { ...prev, [collection]: nextList }
        dataRef.current = next
        return next
      })
      await repo.put(collection, item)
      return item
    },
    [repo],
  )

  const remove = useCallback(
    async (collection: CollectionName, id: string) => {
      setData((prev) => ({ ...prev, [collection]: (prev[collection] as Entity[]).filter((x) => x.id !== id) }))
      await repo.remove(collection, id)
    },
    [repo],
  )

  const toBase = useCallback(
    (amount: Cents, currency: Currency) => {
      const value = convert(amount, currency, settingsRef.current.baseCurrency)
      if (value === null) throw new MissingRateError()
      return value
    },
    [convert],
  )

  const addTransaction = useCallback<Store['addTransaction']>(
    async ({ type, amount, currency, reason }) => {
      const base = toBase(amount, currency)
      return save('transactions', { type, amount, currency, reason, baseAmount: type === 'in' ? base : -base })
    },
    [save, toBase],
  )

  const updateTransaction = useCallback<Store['updateTransaction']>(
    async (tx, { amount, currency, reason }) => {
      // Keep the rate from the original moment when only the amount changes.
      const base =
        currency === tx.currency && tx.amount > 0
          ? Math.round((Math.abs(tx.baseAmount) / tx.amount) * amount)
          : toBase(amount, currency)
      const sign = tx.type === 'out' || (tx.type === 'adjust' && tx.baseAmount < 0) ? -1 : 1
      return save('transactions', { ...tx, amount, currency, reason, baseAmount: sign * base })
    },
    [save, toBase],
  )

  const adjustBalance = useCallback(
    async (target: Cents) => {
      const current = balanceOf(settingsRef.current, dataRef.current.transactions)
      const delta = target - current
      if (delta === 0) return null
      return save('transactions', {
        type: 'adjust',
        amount: Math.abs(delta),
        currency: settingsRef.current.baseCurrency,
        baseAmount: delta,
        reason: 'Ajuste de saldo',
      })
    },
    [save],
  )

  const completeOnboarding = useCallback(
    async (baseCurrency: Currency, initialBalance: Cents, modules?: Partial<Record<ModuleId, boolean>>) => {
      setDisplayPref(baseCurrency)
      writePref('displayCurrency', baseCurrency)
      await updateSettings({
        onboarded: true,
        baseCurrency,
        initialBalance,
        startedAt: new Date().toISOString(),
        displayCurrency: baseCurrency,
        currencies: [baseCurrency, ...STARTER_CURRENCIES.filter((c) => c !== baseCurrency)],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(modules ? { modules, modulesReviewed: true } : {}),
      })
    },
    [updateSettings],
  )

  const importData = useCallback(
    async (incoming: Partial<DataState>, incomingSettings: Settings | null, mode: 'merge' | 'replace') => {
      let nextData: DataState
      let nextSettings: Settings
      if (mode === 'replace') {
        nextData = { ...EMPTY_DATA, ...incoming }
        nextSettings = { ...DEFAULT_SETTINGS, ...(incomingSettings ?? settingsRef.current), onboarded: true }
      } else {
        nextData = { ...dataRef.current }
        for (const name of COLLECTION_NAMES) {
          const byId = new Map((dataRef.current[name] as Entity[]).map((x) => [x.id, x]))
          for (const item of (incoming[name] ?? []) as Entity[]) {
            const existing = byId.get(item.id)
            if (!existing || existing.updatedAt < item.updatedAt) byId.set(item.id, item)
          }
          ;(nextData as Record<string, Entity[]>)[name] = [...byId.values()]
        }
        nextSettings = settingsRef.current
      }
      await repo.bulkWrite(nextData, nextSettings, mode === 'replace')
      setData(nextData)
      setSettings(nextSettings)
    },
    [repo],
  )

  const balance = useMemo(() => balanceOf(settings, data.transactions), [settings, data.transactions])

  const value: Store = {
    ready,
    loadError,
    retryLoad: () => setAttempt((n) => n + 1),
    repository: repo,
    syncStatus,
    data,
    settings,
    balance,
    displayCurrency,
    convert,
    hasRates: rates !== null,
    ratesLoading,
    setDisplayCurrency,
    save,
    remove,
    addTransaction,
    updateTransaction,
    adjustBalance,
    updateSettings,
    completeOnboarding,
    refreshRates,
    importData,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside StoreProvider')
  return store
}

/**
 * Converts an amount into the currency currently being displayed.
 * Falls back to the original currency when there is no rate (never invents one).
 */
export function useDisplayMoney() {
  const { convert, displayCurrency } = useStore()
  return useCallback(
    (cents: Cents, from: Currency): { cents: Cents; currency: Currency } => {
      const converted = convert(cents, from, displayCurrency)
      return converted === null ? { cents, currency: from } : { cents: converted, currency: displayCurrency }
    },
    [convert, displayCurrency],
  )
}
