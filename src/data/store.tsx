import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { safeRulesForWrite, type ExecuteOptions } from '../core/rules/engine'
import type { WriteActor } from '../core/rules/types'
import { applyOps } from '../core/rules/work'
import { readPref, writePref } from '../lib/prefs'
import { effectiveRates, fetchRates, makeConverter, RATES_MAX_AGE_MS, type Converter } from '../lib/rates'
import { DEFAULT_SETTINGS, normalizeSettings } from './normalize'
import { createIndexedDbRepository, type BatchOp, type Repository, type SyncStatus } from './repository'
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

export { DEFAULT_SETTINGS }

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type Draft<T extends Entity> = Omit<T, keyof Entity> & Partial<Entity>

export interface SaveOptions {
  by?: 'assistant'
  keepMark?: boolean
  /** Who is writing, for the rules (default: the person; `keepMark` = an undo). */
  actor?: WriteActor
}

export interface CommitOptions {
  /** Who is writing, for the rules: writes by rules and undos never trigger rules. Default: the person. */
  by?: WriteActor
  /** Parte 3 (import of a statement): how the rules treat this write (more runs allowed, rules left out). */
  rules?: Pick<ExecuteOptions, 'maxRuns' | 'skip'>
}

/** Same stamping as save(): a normal change clears the Assistant mark. */
function stampOps(ops: BatchOp[], now: string): BatchOp[] {
  return ops.map((o) => {
    if (o.op !== 'put') return o
    const { changedBy: _mark, ...rest } = o.item
    void _mark
    return { ...o, item: { ...rest, createdAt: rest.createdAt || now, updatedAt: now } }
  })
}

const applyToState = applyOps

/** Optional details (Etapa 3). Left out = the record keeps exactly what it had. */
export interface TransactionExtras {
  category?: string | null
  unnecessary?: boolean
}

/**
 * Applies optional details without touching records that never had them: an
 * empty category or an unmarked expense removes the key instead of writing it.
 */
export function withExtras<T extends Partial<Transaction>>(tx: T, type: TransactionType, extras: TransactionExtras): T {
  const out = { ...tx }
  if ('category' in extras) {
    if (extras.category && type !== 'adjust') out.category = extras.category
    else delete out.category
  }
  if ('unnecessary' in extras) {
    if (extras.unnecessary && type === 'out') out.unnecessary = true
    else delete out.unnecessary
  }
  return out
}

/**
 * A restore ("substituir tudo") is a deliberate choice made now: every restored record and the
 * restored settings are stamped as the newest version. Signed in, the server keeps only the newest
 * write, so with the backup's old dates the account's later edits would win and the restore would
 * be silently undone at the next sync.
 */
export function restoreBackup(incoming: Partial<DataState>, settings: Settings | null, now = new Date().toISOString()): { data: DataState; settings: Settings | null } {
  const data = { ...EMPTY_DATA }
  for (const name of COLLECTION_NAMES) {
    ;(data as Record<string, Entity[]>)[name] = ((incoming[name] ?? []) as Entity[]).map((x) => ({ ...x, updatedAt: now }))
  }
  return { data, settings: settings ? { ...normalizeSettings(settings), onboarded: true, updatedAt: now } : null }
}

/**
 * "Mesclar" a backup: an item of the file wins only when it is newer than the one here. `changed` is
 * just what the file brings new — the only part written (and, signed in, sent) again (M7).
 */
export function mergeImport(current: DataState, incoming: Partial<DataState>): { data: DataState; changed: Partial<DataState> } {
  const data = { ...current }
  const changed: Partial<DataState> = {}
  for (const name of COLLECTION_NAMES) {
    const byId = new Map((current[name] as Entity[]).map((x) => [x.id, x]))
    const newer: Entity[] = []
    for (const item of (incoming[name] ?? []) as Entity[]) {
      const existing = byId.get(item.id)
      if (!existing || existing.updatedAt < item.updatedAt) {
        byId.set(item.id, item)
        newer.push(item)
      }
    }
    ;(data as Record<string, Entity[]>)[name] = [...byId.values()]
    if (newer.length) (changed as Record<string, Entity[]>)[name] = newer
  }
  return { data, changed }
}

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
  /**
   * Saves a record. A normal save clears the "Alterado pelo Assistente" mark;
   * the Assistant passes { by: 'assistant' }; undo passes { keepMark: true }.
   */
  save<K extends CollectionName>(collection: K, draft: Draft<Collections[K]>, opts?: SaveOptions): Promise<Collections[K]>
  remove(collection: CollectionName, id: string): Promise<void>
  /**
   * Several saves/removals applied together (on screen and on the device), e.g. a payment and its income.
   * The actions of the person's rules that answer this write are added to the same write.
   */
  commit(ops: BatchOp[], opts?: CommitOptions): Promise<void>
  addTransaction(input: { type: Exclude<TransactionType, 'adjust'>; amount: Cents; currency: Currency; reason: string } & TransactionExtras): Promise<Transaction>
  updateTransaction(tx: Transaction, patch: { amount: Cents; currency: Currency; reason: string } & TransactionExtras): Promise<Transaction>
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
        if (settings) setSettings(normalizeSettings(settings))
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
          const next = normalizeSettings(settings)
          settingsRef.current = next
          setSettings(next)
        }
      })
    })
  }, [repo])

  const rates = useMemo(() => effectiveRates(settings), [settings])
  const convert = useMemo(() => makeConverter(rates), [rates])
  const convertRef = useRef(convert)
  convertRef.current = convert

  /**
   * The writes the person's rules add to this write (read before the write is applied). If the
   * engine fails, the write goes on without the rules — it never blocks what the person is doing.
   */
  const rulesFor = useCallback(
    (ops: BatchOp[], actor: WriteActor, opts?: CommitOptions['rules']): BatchOp[] => safeRulesForWrite(dataRef.current, settingsRef.current, convertRef.current, ops, actor, new Date(), opts),
    [],
  )

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settingsRef.current, ...patch, updatedAt: new Date().toISOString() }
      settingsRef.current = next
      setSettings(next)
      await repo.saveSettings(next, Object.keys(patch) as (keyof Settings)[])
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
    async <K extends CollectionName>(collection: K, draft: Draft<Collections[K]>, opts: SaveOptions = {}) => {
      const now = new Date().toISOString()
      const { changedBy, ...rest } = draft
      const mark = opts.by ?? (opts.keepMark ? changedBy : undefined)
      const item = { ...rest, ...(mark ? { changedBy: mark } : {}), id: draft.id ?? newId(), createdAt: draft.createdAt ?? now, updatedAt: now } as Collections[K]
      const actor: WriteActor = opts.actor ?? (opts.by === 'assistant' ? 'assistant' : opts.keepMark ? 'undo' : 'person')
      const own: BatchOp = { op: 'put', collection, item }
      const extra = stampOps(rulesFor([own], actor), now)
      const all = [own, ...extra]
      // The next write (even before React renders) must already see this one as "before".
      dataRef.current = applyToState(dataRef.current, all)
      setData((prev) => applyToState(prev, all))
      if (!extra.length) await repo.put(collection, item)
      else if (repo.batch) await repo.batch(all)
      else for (const o of all) await (o.op === 'put' ? repo.put(o.collection, o.item as never) : repo.remove(o.collection, o.id))
      return item
    },
    [repo, rulesFor],
  )

  const remove = useCallback(
    async (collection: CollectionName, id: string) => {
      setData((prev) => ({ ...prev, [collection]: (prev[collection] as Entity[]).filter((x) => x.id !== id) }))
      await repo.remove(collection, id)
    },
    [repo],
  )

  const commit = useCallback(
    async (ops: BatchOp[], opts: CommitOptions = {}) => {
      if (!ops.length) return
      const now = new Date().toISOString()
      const stamped = stampOps(ops, now)
      const all = [...stamped, ...stampOps(rulesFor(stamped, opts.by ?? 'person', opts.rules), now)]
      // The next write (even before React renders) must already see this one as "before".
      dataRef.current = applyToState(dataRef.current, all)
      setData((prev) => applyToState(prev, all))
      if (repo.batch) await repo.batch(all)
      else for (const o of all) await (o.op === 'put' ? repo.put(o.collection, o.item as never) : repo.remove(o.collection, o.id))
    },
    [repo, rulesFor],
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
    async ({ type, amount, currency, reason, ...extras }) => {
      const base = toBase(amount, currency)
      return save('transactions', withExtras({ type, amount, currency, reason, baseAmount: type === 'in' ? base : -base }, type, extras))
    },
    [save, toBase],
  )

  const updateTransaction = useCallback<Store['updateTransaction']>(
    async (tx, { amount, currency, reason, ...extras }) => {
      // Keep the rate from the original moment when only the amount changes.
      const base =
        currency === tx.currency && tx.amount > 0
          ? Math.round((Math.abs(tx.baseAmount) / tx.amount) * amount)
          : toBase(amount, currency)
      const sign = tx.type === 'out' || (tx.type === 'adjust' && tx.baseAmount < 0) ? -1 : 1
      return save('transactions', withExtras({ ...tx, amount, currency, reason, baseAmount: sign * base }, tx.type, extras))
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
        ...(modules ? { modules, modulesReviewed: true, modulesSeen: Object.keys(modules) as ModuleId[] } : {}),
      })
    },
    [updateSettings],
  )

  const importData = useCallback(
    async (incoming: Partial<DataState>, incomingSettings: Settings | null, mode: 'merge' | 'replace') => {
      let nextData: DataState
      let changed: Partial<DataState> = {}
      /** Only a restore with settings in the file writes settings; a merge keeps the account's as they are. */
      let writeSettings: Settings | null = null
      if (mode === 'replace') {
        const restored = restoreBackup(incoming, incomingSettings)
        nextData = restored.data
        writeSettings = restored.settings
      } else {
        const merged = mergeImport(dataRef.current, incoming)
        nextData = merged.data
        changed = merged.changed
      }
      // A merge writes (and, signed in, sends) only what the file brings new; the rest stays as it is (M7).
      await repo.bulkWrite(mode === 'replace' ? nextData : changed, writeSettings, mode === 'replace')
      dataRef.current = nextData
      setData(nextData)
      if (writeSettings) {
        settingsRef.current = writeSettings
        setSettings(writeSettings)
      } else if (mode === 'replace' && !settingsRef.current.onboarded) await updateSettings({ onboarded: true })
    },
    [repo, updateSettings],
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
    commit,
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
