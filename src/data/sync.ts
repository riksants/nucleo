import type { SupabaseClient } from '@supabase/supabase-js'
import {
  databaseHandle,
  done,
  META,
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
  /**
   * Set when the server refused this exact version for good (too large,
   * invalid). It stays on the device, never blocks the rest of the sync and is
   * sent again as soon as the record changes (a new entry replaces this one).
   */
  rejected?: { reason: string; at: string }
}

/** A refusal about the data itself (not the network): retrying the same rows won't help. */
export class RejectedRowError extends Error {}

/** Postgres data errors (22xxx/23xxx) and "payload too large" are about the rows, not the connection. */
export function isRowRejection(error: { code?: string | null; message?: string } | null | undefined, status?: number): boolean {
  if (!error) return false
  if (status === 413) return true
  const code = error.code ?? ''
  return /^2[23]/.test(code) || /payload too large|request entity too large/i.test(error.message ?? '')
}

/** The app is newer than the database: some sections stay queued on the device until the SQL migration runs. */
export class ServerOutdatedError extends Error {
  constructor() {
    super('Algumas seções novas ainda não podem ser salvas na nuvem: o banco precisa da atualização (migração SQL). Elas ficam guardadas neste aparelho até lá.')
  }
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
/** Rows per download request. */
export const PAGE = 1000

export function cacheDbName(uid: string) {
  return `nucleo-u-${uid}`
}

export function createSupabaseRemote(client: SupabaseClient, uid: string): RemoteApi {
  return {
    async upsert(rows) {
      const { error, status } = await client.from('records').upsert(
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
      if (error) throw isRowRejection(error, status) && !error.message.includes('records_collection_check') ? new RejectedRowError(error.message) : new Error(error.message)
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

/** Settings this device changed and has not sent yet. Missing while dirty = all of them. */
const DIRTY_KEYS = 'settingsDirtyKeys'

/** Marks the settings as waiting to be sent, adding `changed` to the keys already waiting (null = everything). */
function markSettingsDirty(store: IDBObjectStore, changed: readonly string[] | null) {
  const wasDirty = store.get('settingsDirty')
  const prevKeys = store.get(DIRTY_KEYS)
  prevKeys.onsuccess = () => {
    const was = wasDirty.result === true
    const prev = prevKeys.result as string[] | undefined
    store.put(true, 'settingsDirty')
    // Already dirty without a key list (older app version, restore) stays "everything".
    if (changed === null || (was && !prev)) store.delete(DIRTY_KEYS)
    else store.put([...new Set([...(was ? prev! : []), ...changed])], DIRTY_KEYS)
  }
}

/**
 * What goes to the server: the account's current settings with only the keys this device changed
 * on top. A device that was closed for a while (old settings in memory) can no longer erase what
 * another device changed meanwhile — the vault, sections, tab bar... The stamp is always newer
 * than the server's so the write is accepted.
 */
export function mergeSettings(local: Settings, keys: readonly string[] | null, server: { data: Settings; updatedAt: string } | null): Settings {
  const stamp = local.updatedAt ?? new Date().toISOString()
  if (!keys || !server) return { ...local, updatedAt: stamp }
  const merged: Record<string, unknown> = { ...server.data }
  const mine = local as unknown as Record<string, unknown>
  for (const k of keys) {
    if (k === 'updatedAt') continue
    if (k in mine && mine[k] !== undefined) merged[k] = mine[k]
    else delete merged[k]
  }
  const updatedAt = stamp > server.updatedAt ? stamp : new Date(new Date(server.updatedAt).getTime() + 1).toISOString()
  return { ...merged, updatedAt } as unknown as Settings
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
  const database = databaseHandle(cacheDbName(uid))
  const listeners = new Set<(e: RepoEvent) => void>()
  let status: SyncStatus = { state: 'idle', pending: 0, lastSyncAt: null, error: null }
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null
  /** Last flush hit collections the server doesn't accept yet (migration pending). */
  let outdated = false
  /** The last flush merged settings from another device into this one (the screen must reload them). */
  let settingsMerged = false
  let disposed = false

  const emit = (e: RepoEvent) => listeners.forEach((l) => l(e))
  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch }
    emit({ type: 'status' })
  }

  async function outbox(): Promise<OutboxEntry[]> {
    const db = await database.get()
    return (await request(db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll())) as OutboxEntry[]
  }

  async function pendingCount() {
    const n = (await outbox()).length + ((await readMeta<boolean>(await database.get(), 'settingsDirty')) ? 1 : 0)
    return n
  }

  async function rejectedCount() {
    return (await outbox()).filter((e) => e.rejected).length
  }

  async function enqueue(collection: CollectionName, id: string, data: Entity | null) {
    const db = await database.get()
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
    const db = await database.get()
    // Versions the server refused for good wait until the record changes again.
    const entries = (await outbox()).filter((e) => !e.rejected)
    const rejected: string[] = []
    const refused: { entry: OutboxEntry; reason: string }[] = []
    for (let i = 0; i < entries.length; i += BATCH) {
      const all = entries.slice(i, i + BATCH)
      // Sent per collection: if the server doesn't accept one collection yet
      // (database not migrated), the others still sync and nothing is lost.
      const byCollection = new Map<CollectionName, OutboxEntry[]>()
      for (const e of all) byCollection.set(e.collection, [...(byCollection.get(e.collection) ?? []), e])
      const batch: OutboxEntry[] = []
      for (const [collection, group] of byCollection) {
        const send = (list: OutboxEntry[]) => remote.upsert(list.map((e) => ({ collection: e.collection, id: e.id, data: e.data, deleted: e.deleted, client_updated_at: e.updatedAt })))
        try {
          await send(group)
          batch.push(...group)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message.includes('records_collection_check')) {
            rejected.push(collection)
            continue
          }
          if (!(err instanceof RejectedRowError)) throw err // network / server down: try again later, nothing lost
          // One bad row must not block the others: send them one by one and set aside only the refused ones.
          for (const e of group) {
            try {
              await send([e])
              batch.push(e)
            } catch (one) {
              if (!(one instanceof RejectedRowError)) throw one
              refused.push({ entry: e, reason: one.message })
            }
          }
        }
      }
      // Read back what the server kept: a newer edit from another device wins over a late one.
      const serverRows: RemoteRow[] = []
      for (const [collection, group] of byCollection) {
        if (!rejected.includes(collection)) serverRows.push(...(await remote.fetch(collection, group.map((e) => e.id))))
      }
      const current = new Map((await outbox()).map((e) => [e.key, e]))
      const tx = db.transaction([...COLLECTION_NAMES, OUTBOX], 'readwrite')
      for (const e of batch) {
        const now = current.get(e.key)
        if (now && now.updatedAt === e.updatedAt) tx.objectStore(OUTBOX).delete(e.key)
      }
      // Refused versions stay in the outbox (so a download never overwrites them) but are marked.
      for (const { entry, reason } of refused.splice(0)) {
        const now = current.get(entry.key)
        if (now && now.updatedAt === entry.updatedAt) tx.objectStore(OUTBOX).put({ ...now, rejected: { reason: reason.slice(0, 200), at: new Date().toISOString() } } satisfies OutboxEntry)
      }
      for (const row of serverRows) {
        const sent = batch.find((e) => e.collection === row.collection && e.id === row.id)
        if (!sent || row.client_updated_at <= sent.updatedAt) continue
        if (row.deleted || !row.data) tx.objectStore(row.collection).delete(row.id)
        else tx.objectStore(row.collection).put(row.data)
      }
      await done(tx)
    }
    outdated = rejected.length > 0

    if (await readMeta<boolean>(db, 'settingsDirty')) {
      const { settings } = await readAll(db)
      if (settings) {
        const keys = (await readMeta<string[]>(db, DIRTY_KEYS)) ?? null
        const merged = mergeSettings(settings, keys, keys ? await remote.loadSettings() : null)
        await remote.saveSettings(merged, merged.updatedAt!)
        // Keeps the merged copy unless the settings changed again while sending (then they go next time).
        const tx = db.transaction(META, 'readwrite')
        const store = tx.objectStore(META)
        const latest = store.get(SETTINGS_KEY)
        let applied = false
        latest.onsuccess = () => {
          if ((latest.result as Settings | undefined)?.updatedAt !== settings.updatedAt) return
          store.put(merged, SETTINGS_KEY)
          store.put(false, 'settingsDirty')
          store.delete(DIRTY_KEYS)
          applied = true
        }
        await done(tx)
        if (applied && JSON.stringify(merged) !== JSON.stringify(settings)) settingsMerged = true
      }
    }
  }

  /** Applies remote changes. Returns true when anything changed locally. */
  async function pull(): Promise<boolean> {
    const db = await database.get()
    let changed = false
    let cursor = (await readMeta<string>(db, 'cursor')) ?? null
    // The 5 s overlap (clock skew, slow commits) is applied once, at the start of this pull.
    // Next pages continue from the last row received, so a burst of more than one page of
    // rows written within a few seconds can never make the same page come back forever.
    let since = cursor ? new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS).toISOString() : null
    const seen = new Set<string>()
    for (;;) {
      const rows = await remote.pullSince(since, PAGE)
      const pending = new Set((await outbox()).map((e) => e.key))
      const fresh = rows.filter((r) => !seen.has(`${r.collection}:${r.id}:${r.server_updated_at}`))
      for (const r of rows) seen.add(`${r.collection}:${r.id}:${r.server_updated_at}`)
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
      // Done when the page wasn't full — or when it brought nothing new (never loop on the same rows).
      if (rows.length < PAGE || !fresh.length || !last) break
      // 1 ms back so rows sharing the boundary timestamp are not skipped (they are deduplicated above).
      since = new Date(new Date(last).getTime() - 1).toISOString()
    }

    if (!(await readMeta<boolean>(db, 'settingsDirty'))) {
      const remoteSettings = await remote.loadSettings()
      if (remoteSettings) {
        // Checked again in the writing transaction: a setting changed here during the download wins
        // (it is merged and sent by the next flush).
        const tx = db.transaction(META, 'readwrite')
        const store = tx.objectStore(META)
        const dirty = store.get('settingsDirty')
        const local = store.get(SETTINGS_KEY)
        local.onsuccess = () => {
          const current = local.result as Settings | undefined
          if (dirty.result === true || (current && (current.updatedAt ?? EPOCH) >= remoteSettings.updatedAt)) return
          store.put({ ...remoteSettings.data, updatedAt: remoteSettings.updatedAt }, SETTINGS_KEY)
          changed = true
        }
        await done(tx)
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
        settingsMerged = false
        await flush()
        const changed = (await pull()) || settingsMerged
        const pending = await pendingCount()
        const refusedNow = await rejectedCount()
        if (refusedNow) setStatus({ state: 'error', error: `${refusedNow} ${refusedNow === 1 ? 'item não pôde ser enviado' : 'itens não puderam ser enviados'} ao servidor. ${refusedNow === 1 ? 'Ele continua' : 'Eles continuam'} salvo${refusedNow === 1 ? '' : 's'} neste aparelho; o restante sincronizou normalmente.`, lastSyncAt: new Date().toISOString(), pending, rejected: refusedNow })
        else if (outdated) setStatus({ state: 'error', error: new ServerOutdatedError().message, lastSyncAt: new Date().toISOString(), pending })
        else setStatus({ state: 'idle', error: null, lastSyncAt: new Date().toISOString(), pending, rejected: 0 })
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
      const db = await database.get()
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

    async saveSettings(settings, changed) {
      const db = await database.get()
      const stamped = { ...settings, updatedAt: settings.updatedAt ?? new Date().toISOString() }
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put(stamped, SETTINGS_KEY)
      markSettingsDirty(tx.objectStore(META), changed ?? null)
      await done(tx)
      scheduleFlush()
    },

    async batch(ops) {
      if (!ops.length) return
      for (const o of ops) if (o.op === 'put' && hasPlainPassword(o.collection, o.item)) throw new PlainPasswordError()
      const db = await database.get()
      const tx = db.transaction([...new Set(ops.map((o) => o.collection)), OUTBOX], 'readwrite')
      const now = new Date().toISOString()
      for (const o of ops) {
        const data = o.op === 'put' ? o.item : null
        const id = o.op === 'put' ? o.item.id : o.id
        if (data) tx.objectStore(o.collection).put(data)
        else tx.objectStore(o.collection).delete(id)
        tx.objectStore(OUTBOX).put({ key: `${o.collection}:${id}`, collection: o.collection, id, data, deleted: !data, updatedAt: data?.updatedAt ?? now } satisfies OutboxEntry)
      }
      await done(tx)
      scheduleFlush()
    },

    async bulkWrite(data, settings, replace) {
      const db = await database.get()
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
        // A restore brings a whole set of settings: all of it is this device's choice.
        markSettingsDirty(tx.objectStore(META), null)
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
      database.close()
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
