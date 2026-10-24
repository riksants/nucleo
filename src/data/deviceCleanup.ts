/**
 * Leaves nothing of an account on this device once its session ends — by "Sair", an expired or
 * revoked session, another tab, or a leftover found when the app opens.
 *
 * Removed: the account's cache (`nucleo-u-<uid>`), the copies of its data in the no-account
 * database that are already safe in the account, and the account's small preferences.
 * Kept: the device's own UI choices (theme, list filters) and anything in the no-account database
 * that never reached the account (declined migration, skipped movements, edits made afterwards).
 */
import { done, LOCAL_DB, META, openDatabase, OUTBOX, readAll, readMeta, request, SETTINGS_KEY } from './repository'
import { cacheDbName, deleteCache } from './sync'
import { COLLECTION_NAMES, type CollectionName, type DataState, type Entity } from './types'

/** What a verified migration sent from the no-account database to an account. */
export interface MigrationMark {
  uid: string
  at: string
  /** Collections whose records were all sent. Missing (older app versions): all but movements. */
  sent?: CollectionName[]
  /** The no-account settings became the account's. */
  settingsCopied?: boolean
}

/** localStorage keys (after the `nucleo:` prefix) that belong to whoever was signed in. */
export const ACCOUNT_PREFS = ['focusTimer', 'shownReminders', 'displayCurrency'] as const
/** The Supabase session; the auth client removes it too, this is only the safety net. */
const AUTH_KEYS = ['nucleo:auth', 'nucleo:auth-user']
/** Accounts that opened a cache on this device (backs up the database list where it's missing). */
const REGISTRY = 'nucleo:accountsOnDevice'
const CACHE_PREFIX = 'nucleo-u-'

function readRegistry(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(REGISTRY) ?? '[]')
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRegistry(list: string[]) {
  try {
    if (list.length) localStorage.setItem(REGISTRY, JSON.stringify(list))
    else localStorage.removeItem(REGISTRY)
  } catch {
    // storage unavailable: the database list still finds the caches
  }
}

const releasers = new Set<(uid: string) => void>()

/** Called before an account's data is removed: whatever still uses it (its sync) must stop first. */
export function onAccountRemoval(release: (uid: string) => void): () => void {
  releasers.add(release)
  return () => releasers.delete(release)
}

export function rememberAccountOnDevice(uid: string) {
  const list = readRegistry()
  if (!list.includes(uid)) writeRegistry([...list, uid])
}

/** Accounts with a cache on this device. */
export async function accountsOnDevice(): Promise<string[]> {
  const found = new Set(readRegistry())
  try {
    for (const db of (await indexedDB.databases?.()) ?? []) {
      if (db.name?.startsWith(CACHE_PREFIX)) found.add(db.name.slice(CACHE_PREFIX.length))
    }
  } catch {
    // older browsers without databases(): the registry is enough
  }
  return [...found]
}

/** True when the database exists. Never creates it (the upgrade of a missing one is aborted). */
function databaseExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let created = false
    const req = indexedDB.open(name)
    req.onupgradeneeded = () => {
      created = true
      req.transaction?.abort()
    }
    req.onsuccess = () => {
      req.result.close()
      resolve(!created)
    }
    req.onerror = () => resolve(false)
  })
}

interface CacheView {
  data: DataState
  /** `collection:id` of changes that never reached the server. */
  pending: Set<string>
}

async function readCache(uid: string): Promise<CacheView | null> {
  if (!(await databaseExists(cacheDbName(uid)))) return null
  const db = await openDatabase(cacheDbName(uid))
  try {
    const { data } = await readAll(db)
    const outbox = (await request(db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll())) as { key: string }[]
    return { data, pending: new Set(outbox.map((e) => e.key)) }
  } finally {
    db.close()
  }
}

/**
 * Deletes from the no-account database the records that are this account's data: sent by a
 * verified migration and not changed since, or present in the account's cache (already on the
 * server) at the same or a newer version. Returns how many were removed.
 */
export async function removeAccountCopyFromLocal(uid: string, cache?: CacheView | null): Promise<number> {
  if (!(await databaseExists(LOCAL_DB))) return 0
  const db = await openDatabase(LOCAL_DB)
  try {
    const mark = ((await readMeta<MigrationMark[]>(db, 'migratedTo')) ?? []).find((m) => m.uid === uid)
    if (!mark) return 0
    const account = cache === undefined ? await readCache(uid) : cache
    const sent = new Set<CollectionName>(mark.sent ?? COLLECTION_NAMES.filter((n) => n !== 'transactions'))
    const { data, settings } = await readAll(db)
    const tx = db.transaction([...COLLECTION_NAMES, META], 'readwrite')
    let removed = 0
    for (const name of COLLECTION_NAMES) {
      const inAccount = new Map(((account?.data[name] ?? []) as Entity[]).map((x) => [x.id, x]))
      for (const item of data[name] as Entity[]) {
        const stamp = item.updatedAt ?? ''
        const sentUnchanged = sent.has(name) && stamp <= mark.at
        const there = inAccount.get(item.id)
        const confirmed = Boolean(there && !account!.pending.has(`${name}:${item.id}`) && (there.updatedAt ?? '') >= stamp)
        if (!sentUnchanged && !confirmed) continue
        tx.objectStore(name).delete(item.id)
        removed++
      }
    }
    if (mark.settingsCopied && settings && (settings.updatedAt ?? '') <= mark.at) tx.objectStore(META).delete(SETTINGS_KEY)
    await done(tx)
    return removed
  } finally {
    db.close()
  }
}

/**
 * Everything of one account on this device. `wholeDevice` (nobody else signed in) also clears the
 * account's preferences and the session keys; with another account signed in they are that one's.
 * Returns the changes that were still waiting to be sent (lost with the cache).
 */
export async function removeAccountFromDevice(uid: string, opts: { wholeDevice: boolean }): Promise<{ pendingLost: number }> {
  for (const release of releasers) release(uid)
  // Another tab may be deleting this cache right now (its connection closes under us): go on
  // without it — only what the migration mark proves to be in the account leaves the local copy.
  const cache = await readCache(uid).catch(() => null)
  await removeAccountCopyFromLocal(uid, cache)
  await deleteCache(uid)
  if (opts.wholeDevice) {
    try {
      for (const key of ACCOUNT_PREFS) localStorage.removeItem(`nucleo:${key}`)
      for (const key of AUTH_KEYS) localStorage.removeItem(key)
    } catch {
      // storage unavailable: nothing was stored there either
    }
  }
  writeRegistry(readRegistry().filter((x) => x !== uid))
  return { pendingLost: cache?.pending.size ?? 0 }
}
