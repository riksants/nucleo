import { COLLECTION_NAMES, type CollectionName, type Collections, type DataState, type Entity, type Settings } from './types'

export type RepoEvent = { type: 'data' } | { type: 'status' }

/** One write of a batch: all of them are applied together, or none (used by received payments ↔ Financeiro). */
export type BatchOp = { op: 'put'; collection: CollectionName; item: Entity } | { op: 'remove'; collection: CollectionName; id: string }

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error'
  pending: number
  lastSyncAt: string | null
  error: string | null
  /** Changes the server refused for good (kept on this device; retried when edited). */
  rejected?: number
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
  /**
   * `changed`: the settings this edit touched. Signed in, only those are sent over the account's
   * settings; everything else keeps the newest value from the server (another device may have changed it).
   * Left out = the whole object is this device's choice.
   */
  saveSettings(settings: Settings, changed?: (keyof Settings)[]): Promise<void>
  /**
   * Several puts/removes in one device transaction: a payment and its income in Financeiro are
   * saved together or not at all (signed in, they also enter the send queue together).
   */
  batch(ops: BatchOp[]): Promise<void>
  /** Writes every item in one transaction. With `replace`, existing records are cleared first. */
  bulkWrite(data: Partial<DataState>, settings: Settings | null, replace: boolean): Promise<void>
  /** Remote changes and sync status (synced repository only). */
  subscribe?(listener: (event: RepoEvent) => void): () => void
  status?(): SyncStatus
  syncNow?(): Promise<void>
  dispose?(): void
}

export const LOCAL_DB = 'nucleo'
export const DB_VERSION = 7
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

/** The device database can't be upgraded while an older version of the app keeps it open elsewhere. */
export const DATABASE_BLOCKED = 'Uma versão anterior do NÚCLEO ainda está aberta em outra aba ou janela. Feche-a para concluir a atualização — esta tela continua sozinha quando ela fechar.'

export class DatabaseBlockedError extends Error {
  constructor() {
    super(DATABASE_BLOCKED)
  }
}

const reload = () => {
  if (typeof location !== 'undefined') location.reload()
}

/**
 * Opens (and upgrades) a database with one store per collection plus meta and outbox.
 *
 * Updates: when a newer version of the app needs to upgrade the database, this connection closes
 * and the page reloads into the new version (otherwise the new one would wait forever, blank).
 * If an old version without this handler still holds the database, the open fails with
 * DatabaseBlockedError (a message instead of a blank screen) and the page reloads by itself
 * as soon as the database is free.
 */
export function openDatabase(name: string = LOCAL_DB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    let blocked = false
    req.onupgradeneeded = () => {
      const db = req.result
      for (const store of COLLECTION_NAMES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' })
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = (e) => {
        db.close()
        // A deletion (signing out removes that account's copy) only closes; an upgrade reloads.
        if (e.newVersion !== null) reload()
      }
      if (!blocked) return resolve(db)
      // The message was shown while waiting; the database is free now: start again normally.
      db.close()
      reload()
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => {
      blocked = true
      reject(new DatabaseBlockedError())
    }
  })
}

/**
 * The device database for a repository. An open that failed is tried again on the next use — except
 * when blocked by an old version in another tab: a new attempt would only queue behind the waiting
 * one, so that case waits for the automatic reload (or the reload button on the error screen).
 */
export function databaseHandle(name: string) {
  let current = openDatabase(name)
  current.catch(() => {})
  return {
    get: () => (current = current.catch((err) => (err instanceof DatabaseBlockedError ? Promise.reject(err) : openDatabase(name)))),
    close: () => void current.then((db) => db.close(), () => {}),
  }
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
  const database = databaseHandle(name)

  return {
    async load() {
      return readAll(await database.get())
    },

    async put(collection, item) {
      const db = await database.get()
      const tx = db.transaction(collection, 'readwrite')
      tx.objectStore(collection).put(item)
      await done(tx)
    },

    async remove(collection, id) {
      const db = await database.get()
      const tx = db.transaction(collection, 'readwrite')
      tx.objectStore(collection).delete(id)
      await done(tx)
    },

    async saveSettings(settings) {
      const db = await database.get()
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put(settings, SETTINGS_KEY)
      await done(tx)
    },

    async batch(ops) {
      if (!ops.length) return
      const db = await database.get()
      const tx = db.transaction([...new Set(ops.map((o) => o.collection))], 'readwrite')
      for (const o of ops) {
        if (o.op === 'put') tx.objectStore(o.collection).put(o.item)
        else tx.objectStore(o.collection).delete(o.id)
      }
      await done(tx)
    },

    async bulkWrite(data, settings, replace) {
      const db = await database.get()
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
