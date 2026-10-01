import { LOCAL_DB, META, openDatabase, readAll, readMeta, SETTINGS_KEY, writeMeta } from './repository'
import type { RemoteApi } from './sync'
import { COLLECTION_NAMES, type Account, type CollectionName, type DataState, type Entity, type Settings, type Transaction } from './types'

export interface LocalSummary {
  total: number
  counts: Partial<Record<CollectionName, number>>
  settings: Settings | null
  plainPasswords: number
  /** Accounts on this device whose data was already sent (by user id). */
  migratedTo: string[]
}

export async function readLocal(): Promise<{ data: DataState; settings: Settings | null; migratedTo: string[] }> {
  const db = await openDatabase(LOCAL_DB)
  try {
    const { data, settings } = await readAll(db)
    const migrated = (await readMeta<{ uid: string; at: string }[]>(db, 'migratedTo')) ?? []
    return { data, settings, migratedTo: migrated.map((m) => m.uid) }
  } finally {
    db.close()
  }
}

export async function localSummary(): Promise<LocalSummary> {
  const { data, settings, migratedTo } = await readLocal()
  const counts: Partial<Record<CollectionName, number>> = {}
  let total = 0
  for (const name of COLLECTION_NAMES) {
    const n = data[name].length
    if (n) counts[name] = n
    total += n
  }
  const plainPasswords = data.accounts.filter((a) => a.password).length
  return { total, counts, settings: settings?.onboarded ? settings : null, plainPasswords, migratedTo }
}

export interface MigrationPlan {
  /** Local settings become the account's (new account) or the account keeps its own. */
  settings: 'copy' | 'keep'
  /** Finance moves only when both use the same base currency (stored values are never rewritten). */
  moveTransactions: boolean
  /** Local starting balance becomes a visible adjustment when the account already has one. */
  initialAsAdjustment: boolean
}

export function planMigration(local: Settings | null, account: Settings | null, alreadySent = false): MigrationPlan {
  if (!account?.onboarded) return { settings: 'copy', moveTransactions: true, initialAsAdjustment: false }
  const same = !local || local.baseCurrency === account.baseCurrency
  // The account's starting balance already came from this device (earlier migration): never add it twice.
  const fromThisDevice = alreadySent || Boolean(local?.startedAt && local.startedAt === account.startedAt)
  return { settings: 'keep', moveTransactions: same, initialAsAdjustment: same && !fromThisDevice && Boolean(local?.initialBalance) }
}

export interface MigrationResult {
  sent: number
  verified: number
  /** Removed in the account after an earlier migration: not recreated. */
  alreadyDeleted: number
  skipped: Partial<Record<CollectionName, number>>
}

/**
 * Sends this device's local data to the signed-in account.
 * - Same ids are upserted, so running it twice never duplicates anything.
 * - Plain-text passwords are sealed by `sealAccount` before leaving the device.
 * - Every record is read back from the server; only then the device is marked
 *   as migrated. The local copy is never deleted here.
 */
export async function migrateLocalToAccount(opts: {
  uid: string
  remote: RemoteApi
  plan: MigrationPlan
  accountSettings: Settings | null
  sealAccount(account: Account): Promise<Account>
}): Promise<MigrationResult> {
  const { uid, remote, plan } = opts
  const { data, settings } = await readLocal()
  const skipped: MigrationResult['skipped'] = {}
  const rows: { collection: CollectionName; item: Entity }[] = []

  for (const name of COLLECTION_NAMES) {
    if (name === 'transactions' && !plan.moveTransactions) {
      if (data.transactions.length) skipped.transactions = data.transactions.length
      continue
    }
    for (const item of data[name] as Entity[]) {
      const ready = name === 'accounts' ? await opts.sealAccount(item as Account) : item
      if (name === 'accounts' && (ready as Account).password) throw new Error('Uma senha ainda está sem criptografia.')
      rows.push({ collection: name, item: ready })
    }
  }

  if (plan.initialAsAdjustment && settings?.initialBalance) {
    const at = settings.startedAt || new Date().toISOString()
    const adj: Transaction = {
      // Stable id: migrating again does not add the adjustment twice.
      id: `local-initial-${uid.slice(0, 8)}`,
      createdAt: at,
      updatedAt: at,
      type: 'adjust',
      amount: Math.abs(settings.initialBalance),
      currency: settings.baseCurrency,
      baseAmount: settings.initialBalance,
      reason: 'Saldo inicial (dados do aparelho)',
    }
    rows.push({ collection: 'transactions', item: adj })
  }

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    await remote.upsert(chunk.map(({ collection, item }) => ({ collection, id: item.id, data: item, deleted: false, client_updated_at: item.updatedAt })))
  }

  // Verify: every record must exist on the server (or have been deleted there later on purpose).
  let verified = 0
  let alreadyDeleted = 0
  const byCollection = new Map<CollectionName, Entity[]>()
  for (const r of rows) byCollection.set(r.collection, [...(byCollection.get(r.collection) ?? []), r.item])
  for (const [collection, items] of byCollection) {
    for (let i = 0; i < items.length; i += 200) {
      const ids = items.slice(i, i + 200).map((x) => x.id)
      const found = new Map((await remote.fetch(collection, ids)).map((r) => [r.id, r]))
      for (const id of ids) {
        const row = found.get(id)
        if (!row) throw new Error(`Verificação falhou: um registro de ${collection} não chegou ao servidor. Nada foi apagado; tente de novo.`)
        if (row.deleted) alreadyDeleted++
        else verified++
      }
    }
  }

  if (plan.settings === 'copy' && settings) {
    // The account's vault (if one was just created to seal passwords) must survive the copy.
    const stamped = { ...settings, vault: opts.accountSettings?.vault ?? settings.vault ?? null, updatedAt: new Date().toISOString() }
    await remote.saveSettings(stamped, stamped.updatedAt)
  }

  const db = await openDatabase(LOCAL_DB)
  try {
    const list = (await readMeta<{ uid: string; at: string }[]>(db, 'migratedTo')) ?? []
    await writeMeta(db, 'migratedTo', [...list.filter((m) => m.uid !== uid), { uid, at: new Date().toISOString() }])
  } finally {
    db.close()
  }

  return { sent: rows.length, verified, alreadyDeleted, skipped }
}

/** Marks the offer as declined for this account so it is not shown again. */
export async function declineMigration(uid: string) {
  const db = await openDatabase(LOCAL_DB)
  try {
    const list = (await readMeta<string[]>(db, 'migrationDeclined')) ?? []
    if (!list.includes(uid)) await writeMeta(db, 'migrationDeclined', [...list, uid])
  } finally {
    db.close()
  }
}

export async function migrationDeclined(uid: string): Promise<boolean> {
  const db = await openDatabase(LOCAL_DB)
  try {
    return ((await readMeta<string[]>(db, 'migrationDeclined')) ?? []).includes(uid)
  } finally {
    db.close()
  }
}

/** Deletes the no-account copy on this device. Only offered after a verified migration. */
export async function clearLocalData() {
  const db = await openDatabase(LOCAL_DB)
  try {
    const tx = db.transaction([...COLLECTION_NAMES, META], 'readwrite')
    for (const name of COLLECTION_NAMES) tx.objectStore(name).clear()
    tx.objectStore(META).delete(SETTINGS_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
