import type { SupabaseClient } from '@supabase/supabase-js'
import {
  done,
  META,
  openDatabase,
  OUTBOX,
  readAll,
  readMeta,
  request,
  SETTINGS_KEY,
  writeMeta,
  type RepoEvent,
  type Repository,
  type SyncStatus,
} from './repository'
import { COLLECTION_NAMES, type CollectionName, type Entity, type Settings } from './types'

export interface RemoteRow {
  collection: CollectionName
  id: string
  data: Entity | null
  deleted: boolean
  client_updated_at: string
  server_updated_at?: string
}

/** What the synced repository needs from the server. Supabase in the app, a fake in tests. */
export interface RemoteApi {
  upsert(rows: RemoteRow[]): Promise<void>
  fetch(collection: CollectionName, ids: string[]): Promise<RemoteRow[]>
  pullSince(cursor: string | null, limit: number): Promise<RemoteRow[]>
  saveSettings(settings: Settings, updatedAt: string): Promise<void>
  loadSettings(): Promise<{ data: Settings; updatedAt: string } | null>
}

interface OutboxEntry {
  key: string
  collection: CollectionName
  id: string
  data: Entity | null
  deleted: boolean
  updatedAt: string
}

export class PlainPasswordError extends Error {
  constructor() {
    super('Senhas só são sincronizadas criptografadas. Desbloqueie ou crie o cofre.')
  }
}

const EPOCH = '1970-01-01T00:00:00.000Z'
/** Re-reads a few seconds back so rows committed slightly out of order are not missed. */
const CURSOR_OVERLAP_MS = 5000
const BATCH = 200

export function cacheDbName(uid: string) {
  return `nucleo-u-${uid}`
}

export function createSupabaseRemote(client: SupabaseClient, uid: string): RemoteApi {
  return {
    async upsert(rows) {
      const { error } = await client.from('records').upsert(
        rows.map((r) => ({
          user_id: uid,
          collection: r.collection,
          id: r.id,
          data: r.data ?? {},
          deleted: r.deleted,
          client_updated_at: r.client_updated_at,
        })),
        { onConflict: 'user_id,collection,id' },
      )
      if (error) throw new Error(error.message)
    },
    async fetch(collection, ids) {
      const { data, error } = await client
        .from('records')
        .select('collection,id,data,deleted,client_updated_at,server_updated_at')
        .eq('collection', collection)
        .in('id', ids)
      if (error) throw new Error(error.message)
      return (data ?? []) as RemoteRow[]
    },
    async pullSince(cursor, limit) {
      let q = client
        .from('records')
        .select('collection,id,data,deleted,client_updated_at,server_updated_at')
        .order('server_updated_at', { ascending: true })
        .limit(limit)
      if (cursor) q = q.gt('server_updated_at', cursor)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as RemoteRow[]
    },
    async saveSettings(settings, updatedAt) {
      const { error } = await client
        .from('user_settings')
        .upsert({ user_id: uid, data: settings, client_updated_at: updatedAt }, { onConflict: 'user_id' })
      if (error) throw new Error(error.message)
    },
    async loadSettings() {
      const { data, error } = await client.from('user_settings').select('data,client_updated_at').maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { data: data.data as Settings, updatedAt: data.client_updated_at as string } : null
    },
  }
}

function hasPlainPassword(collection: CollectionName, item: Entity): boolean {
  return collection === 'accounts' && Boolean((item as unknown as { password?: string }).password)
}

/**
 * Local-first repository for a signed-in account: reads and writes go to a
 * per-account IndexedDB cache, changes queue in an outbox and are pushed to the
 * server; remote changes are pulled by cursor. Edits made offline are kept.
 */
export function createSyncedRepository(uid: string, remote: RemoteApi, opts: { autoSync?: boolean } = {}): Repository & {
  flush(): Promise<void>
  pull(): Promise<boolean>
  pendingCount(): Promise<number>
} {
  const autoSync = opts.autoSync ?? true
  const dbPromise = openDatabase(cacheDbName(uid))
  const listeners = new Set<(e: RepoEvent) => void>()
  let status: SyncStatus = { state: 'idle', pending: 0, lastSyncAt: null, error: null }
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null
  let disposed = false

  const emit = (e: RepoEvent) => listeners.forEach((l) => l(e))
  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch }
    emit({ type: 'status' })
  }

  async function outbox(): Promise<OutboxEntry[]> {
    const db = await dbPromise
    return (await request(db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll())) as OutboxEntry[]
  }

  async function pendingCount() {
    const n = (await outbox()).length + ((await readMeta<boolean>(await dbPromise, 'settingsDirty')) ? 1 : 0)
    return n
  }

  async function enqueue(collection: CollectionName, id: string, data: Entity | null) {
    const db = await dbPromise
    const tx = db.transaction([collection, OUTBOX], 'readwrite')
    if (data) tx.objectStore(collection).put(data)
    else tx.objectStore(collection).delete(id)
    tx.objectStore(OUTBOX).put({
      key: `${collection}:${id}`,
      collection,
      id,
      data,
      deleted: !data,
      updatedAt: data?.updatedAt ?? new Date().toISOString(),
    } satisfies OutboxEntry)
    await done(tx)
    scheduleFlush()
  }

  function scheduleFlush() {
    if (!autoSync) return
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => void sync(), 800)
  }

  /** Pushes queued changes. Entries edited again while sending stay queued. */
  async function flush() {
    const db = await dbPromise
    const entries = await outbox()
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH)
      await remote.upsert(
        batch.map((e) => ({ collection: e.collection, id: e.id, data: e.data, deleted: e.deleted, client_updated_at: e.updatedAt })),
      )
      // Read back what the server kept: a newer edit from another device wins over a late one.
      const byCollection = new Map<CollectionName, string[]>()
      for (const e of batch) byCollection.set(e.collection, [...(byCollection.get(e.collection) ?? []), e.id])
      const serverRows: RemoteRow[] = []
      for (const [collection, ids] of byCollection) serverRows.push(...(await remote.fetch(collection, ids)))
      const current = new Map((await outbox()).map((e) => [e.key, e]))
      const tx = db.transaction([...COLLECTION_NAMES, OUTBOX], 'readwrite')
      for (const e of batch) {
        const now = current.get(e.key)
        if (now && now.updatedAt === e.updatedAt) tx.objectStore(OUTBOX).delete(e.key)
      }
      for (const row of serverRows) {
        const sent = batch.find((e) => e.collection === row.collection && e.id === row.id)
        if (!sent || row.client_updated_at <= sent.updatedAt) continue
        if (row.deleted || !row.data) tx.objectStore(row.collection).delete(row.id)
        else tx.objectStore(row.collection).put(row.data)
      }
      await done(tx)
    }

    if (await readMeta<boolean>(db, 'settingsDirty')) {
      const { settings } = await readAll(db)
      if (settings) {
        await remote.saveSettings(settings, settings.updatedAt ?? new Date().toISOString())
        const latest = (await readAll(db)).settings
        if (latest?.updatedAt === settings.updatedAt) await writeMeta(db, 'settingsDirty', false)
      }
    }
  }

  /** Applies remote changes. Returns true when anything changed locally. */
  async function pull(): Promise<boolean> {
    const db = await dbPromise
    let changed = false
    let cursor = (await readMeta<string>(db, 'cursor')) ?? null
    for (;;) {
      const since = cursor ? new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS).toISOString() : null
      const rows = await remote.pullSince(since, 1000)
      const pending = new Set((await outbox()).map((e) => e.key))
      const fresh = rows.filter((r) => !cursor || (r.server_updated_at ?? EPOCH) > since!)
      if (fresh.length) {
        const readTx = db.transaction([...COLLECTION_NAMES], 'readonly')
        const existing = await Promise.all(fresh.map((r) => request(readTx.objectStore(r.collection).get(r.id)) as Promise<Entity | undefined>))
        const tx = db.transaction([...COLLECTION_NAMES], 'readwrite')
        fresh.forEach((row, i) => {
          if (pending.has(`${row.collection}:${row.id}`)) return // local edit not sent yet wins
          const local = existing[i]
          if (row.deleted || !row.data) {
            if (local) {
              tx.objectStore(row.collection).delete(row.id)
              changed = true
            }
            return
          }
          if (!local || local.updatedAt !== row.data.updatedAt || JSON.stringify(local) !== JSON.stringify(row.data)) {
            tx.objectStore(row.collection).put(row.data)
            changed = true
          }
        })
        await done(tx)
      }
      const last = rows.at(-1)?.server_updated_at
      if (last && (!cursor || last > cursor)) {
        cursor = last
        await writeMeta(db, 'cursor', cursor)
      }
      if (rows.length < 1000) break
    }

    if (!(await readMeta<boolean>(db, 'settingsDirty'))) {
      const remoteSettings = await remote.loadSettings()
      const local = (await readAll(db)).settings
      if (remoteSettings && (!local || (local.updatedAt ?? EPOCH) < remoteSettings.updatedAt)) {
        const tx = db.transaction(META, 'readwrite')
        tx.objectStore(META).put({ ...remoteSettings.data, updatedAt: remoteSettings.updatedAt }, SETTINGS_KEY)
        await done(tx)
        changed = true
      }
    }
    await writeMeta(db, 'syncedOnce', true)
    return changed
  }

  async function sync() {
    if (running) return running
    running = (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus({ state: 'offline', pending: await pendingCount() })
        return
      }
      setStatus({ state: 'syncing' })
      try {
        await flush()
        const changed = await pull()
        setStatus({ state: 'idle', error: null, lastSyncAt: new Date().toISOString(), pending: await pendingCount() })
        if (changed && !disposed) emit({ type: 'data' })
      } catch (err) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        setStatus({ state: offline ? 'offline' : 'error', error: err instanceof Error ? err.message : String(err), pending: await pendingCount() })
      }
    })().finally(() => {
      running = null
    })
    return running
  }

  let interval: ReturnType<typeof setInterval> | undefined
  const onOnline = () => void sync()
  const onVisible = () => document.visibilityState === 'visible' && void sync()
  if (autoSync && typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    interval = setInterval(() => document.visibilityState === 'visible' && void sync(), 60_000)
  }

  return {
    async load() {
      const db = await dbPromise
      // First time on this device: download everything before showing anything,
      // so an existing account is never mistaken for a new one.
      if (!(await readMeta<boolean>(db, 'syncedOnce'))) {
        await flush()
        await pull()
        status = { ...status, lastSyncAt: new Date().toISOString() }
      } else if (autoSync) {
        void sync()
      }
      return readAll(db)
    },

    async put(collection, item) {
      if (hasPlainPassword(collection, item)) throw new PlainPasswordError()
      await enqueue(collection, item.id, item)
    },

    async remove(collection, id) {
      await enqueue(collection, id, null)
    },

    async saveSettings(settings) {
      const db = await dbPromise
      const stamped = { ...settings, updatedAt: settings.updatedAt ?? new Date().toISOString() }
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put(stamped, SETTINGS_KEY)
      tx.objectStore(META).put(true, 'settingsDirty')
      await done(tx)
      scheduleFlush()
    },

    async bulkWrite(data, settings, replace) {
      const db = await dbPromise
      const current = await readAll(db)
      const now = new Date().toISOString()
      for (const name of COLLECTION_NAMES) {
        for (const item of (data[name] ?? []) as Entity[]) {
          if (hasPlainPassword(name, item)) throw new PlainPasswordError()
        }
      }
      const tx = db.transaction([...COLLECTION_NAMES, OUTBOX, META], 'readwrite')
      for (const name of COLLECTION_NAMES) {
        const incoming = (data[name] ?? []) as Entity[]
        const keep = new Set(incoming.map((x) => x.id))
        if (replace) {
          for (const old of current.data[name] as Entity[]) {
            if (keep.has(old.id)) continue
            tx.objectStore(name).delete(old.id)
            tx.objectStore(OUTBOX).put({ key: `${name}:${old.id}`, collection: name, id: old.id, data: null, deleted: true, updatedAt: now })
          }
        }
        for (const item of incoming) {
          tx.objectStore(name).put(item)
          tx.objectStore(OUTBOX).put({ key: `${name}:${item.id}`, collection: name, id: item.id, data: item, deleted: false, updatedAt: item.updatedAt })
        }
      }
      if (settings) {
        tx.objectStore(META).put({ ...settings, updatedAt: settings.updatedAt ?? now }, SETTINGS_KEY)
        tx.objectStore(META).put(true, 'settingsDirty')
      }
      await done(tx)
      scheduleFlush()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    status: () => status,
    syncNow: () => sync(),
    flush,
    pull,
    pendingCount,

    dispose() {
      disposed = true
      clearTimeout(flushTimer)
      clearInterval(interval)
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        document.removeEventListener('visibilitychange', onVisible)
      }
      void dbPromise.then((db) => db.close())
    },
  }
}

/** Removes this account's cached copy from the device (the server keeps everything). */
export function deleteCache(uid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(cacheDbName(uid))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}
