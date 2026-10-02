import { COLLECTION_NAMES, type CollectionName, type Collections, type DataState, type Settings } from './types'

export type RepoEvent = { type: 'data' } | { type: 'status' }

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error'
  pending: number
  lastSyncAt: string | null
  error: string | null
}

/**
 * Persistence boundary. The UI only talks to this interface: the local
 * IndexedDB implementation (no account) and the synced one (signed in) are
 * interchangeable.
 */
export interface Repository {
  load(): Promise<{ data: DataState; settings: Settings | null }>
  put<K extends CollectionName>(collection: K, item: Collections[K]): Promise<void>
  remove(collection: CollectionName, id: string): Promise<void>
  saveSettings(settings: Settings): Promise<void>
  /** Writes every item in one transaction. With `replace`, existing records are cleared first. */
  bulkWrite(data: Partial<DataState>, settings: Settings | null, replace: boolean): Promise<void>
  /** Remote changes and sync status (synced repository only). */
  subscribe?(listener: (event: RepoEvent) => void): () => void
  status?(): SyncStatus
  syncNow?(): Promise<void>
  dispose?(): void
}

export const LOCAL_DB = 'nucleo'
export const DB_VERSION = 6
export const META = 'meta'
export const OUTBOX = 'outbox'
const SETTINGS_KEY = 'settings'

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Opens (and upgrades) a database with one store per collection plus meta and outbox. */
export function openDatabase(name: string = LOCAL_DB): Promise<IDBDatabase> {
  const req = indexedDB.open(name, DB_VERSION)
  req.onupgradeneeded = () => {
    const db = req.result
    for (const store of COLLECTION_NAMES) {
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' })
    }
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' })
  }
  return request(req)
}

export async function readAll(db: IDBDatabase): Promise<{ data: DataState; settings: Settings | null }> {
  const tx = db.transaction([...COLLECTION_NAMES, META], 'readonly')
  // All requests must be issued before the first await, or the transaction closes.
  const lists = COLLECTION_NAMES.map((name) => request(tx.objectStore(name).getAll()))
  const settingsReq = request(tx.objectStore(META).get(SETTINGS_KEY))
  const [values, settings] = await Promise.all([Promise.all(lists), settingsReq])
  const data = Object.fromEntries(COLLECTION_NAMES.map((name, i) => [name, values[i]])) as unknown as DataState
  return { data, settings: (settings as Settings | undefined) ?? null }
}

export async function readMeta<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  const tx = db.transaction(META, 'readonly')
  return (await request(tx.objectStore(META).get(key))) as T | undefined
}

export async function writeMeta(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  const tx = db.transaction(META, 'readwrite')
  tx.objectStore(META).put(value, key)
  await done(tx)
}

export function createIndexedDbRepository(name: string = LOCAL_DB): Repository {
  const dbPromise = openDatabase(name)

  return {
    async load() {
      return readAll(await dbPromise)
    },

    async put(collection, item) {
      const db = await dbPromise
      const tx = db.transaction(collection, 'readwrite')
      tx.objectStore(collection).put(item)
      await done(tx)
    },

    async remove(collection, id) {
      const db = await dbPromise
      const tx = db.transaction(collection, 'readwrite')
      tx.objectStore(collection).delete(id)
      await done(tx)
    },

    async saveSettings(settings) {
      const db = await dbPromise
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put(settings, SETTINGS_KEY)
      await done(tx)
    },

    async bulkWrite(data, settings, replace) {
      const db = await dbPromise
      const tx = db.transaction([...COLLECTION_NAMES, META], 'readwrite')
      for (const name of COLLECTION_NAMES) {
        const store = tx.objectStore(name)
        if (replace) store.clear()
        for (const item of data[name] ?? []) store.put(item)
      }
      if (settings) tx.objectStore(META).put(settings, SETTINGS_KEY)
      await done(tx)
    },
  }
}

export { SETTINGS_KEY }
