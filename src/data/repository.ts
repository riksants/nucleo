import { COLLECTION_NAMES, type CollectionName, type Collections, type DataState, type Settings } from './types'

/**
 * Persistence boundary. The UI only talks to this interface, so a remote/sync
 * implementation can replace IndexedDB later without touching screens.
 */
export interface Repository {
  load(): Promise<{ data: DataState; settings: Settings | null }>
  put<K extends CollectionName>(collection: K, item: Collections[K]): Promise<void>
  remove(collection: CollectionName, id: string): Promise<void>
  saveSettings(settings: Settings): Promise<void>
  /** Writes every item in one transaction. With `replace`, existing records are cleared first. */
  bulkWrite(data: Partial<DataState>, settings: Settings | null, replace: boolean): Promise<void>
}

const DB_NAME = 'nucleo'
const DB_VERSION = 1
const META = 'meta'
const SETTINGS_KEY = 'settings'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, DB_VERSION)
  req.onupgradeneeded = () => {
    const db = req.result
    for (const name of COLLECTION_NAMES) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
    }
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
  }
  return request(req)
}

export function createIndexedDbRepository(): Repository {
  const dbPromise = openDatabase()

  return {
    async load() {
      const db = await dbPromise
      const tx = db.transaction([...COLLECTION_NAMES, META], 'readonly')
      // All requests must be issued before the first await, or the transaction closes.
      const lists = COLLECTION_NAMES.map((name) => request(tx.objectStore(name).getAll()))
      const settingsReq = request(tx.objectStore(META).get(SETTINGS_KEY))
      const [values, settings] = await Promise.all([Promise.all(lists), settingsReq])
      const data = Object.fromEntries(COLLECTION_NAMES.map((name, i) => [name, values[i]])) as unknown as DataState
      return { data, settings: (settings as Settings | undefined) ?? null }
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
