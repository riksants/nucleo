import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { accountsOnDevice, rememberAccountOnDevice, removeAccountFromDevice, type MigrationMark } from '../src/data/deviceCleanup'
import { migrateLocalToAccount, readLocal } from '../src/data/migration'
import { LOCAL_DB, META, OUTBOX, openDatabase, readAll, readMeta } from '../src/data/repository'
import { cacheDbName, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { Account, CollectionName, Entity, Settings } from '../src/data/types'

/** localStorage for the node test environment. */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

beforeEach(() => {
  // A fresh device for every test.
  globalThis.indexedDB = new IDBFactory()
  globalThis.localStorage = fakeStorage()
})

const T0 = '2026-10-01T10:00:00.000Z'
const MIGRATED_AT = '2026-10-02T10:00:00.000Z'
const LATER = '2026-10-03T10:00:00.000Z'

const note = (id: string, updatedAt = T0, title = id): Entity => ({ id, createdAt: T0, updatedAt, title, body: '', pinned: false }) as unknown as Entity
const account = (id: string, password: string): Account => ({ id, createdAt: T0, updatedAt: T0, name: id, clientId: null, projectId: null, link: '', email: '', username: '', password, secret: null, notes: '' })
const settings = (extra: Partial<Settings> = {}): Settings => ({ onboarded: true, baseCurrency: 'EUR', initialBalance: 5000, startedAt: T0, rates: null, manualRates: {}, lastBackupAt: null, ...extra }) as Settings

/** Writes records (and meta values) straight into a device database. */
async function seed(name: string, records: Partial<Record<CollectionName, Entity[]>>, meta: Record<string, unknown> = {}, outbox: string[] = []) {
  const db = await openDatabase(name)
  const tx = db.transaction([...Object.keys(records), META, OUTBOX], 'readwrite')
  for (const [store, items] of Object.entries(records)) for (const it of items ?? []) tx.objectStore(store).put(it)
  for (const [k, v] of Object.entries(meta)) tx.objectStore(META).put(v, k)
  for (const key of outbox) tx.objectStore(OUTBOX).put({ key, collection: key.split(':')[0], id: key.split(':')[1], data: null, deleted: true, updatedAt: LATER })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function local() {
  const db = await openDatabase(LOCAL_DB)
  try {
    return { ...(await readAll(db)), marks: (await readMeta<MigrationMark[]>(db, 'migratedTo')) ?? [] }
  } finally {
    db.close()
  }
}

async function exists(name: string) {
  return ((await indexedDB.databases()) ?? []).some((d) => d.name === name)
}

/** In-memory server (same id → newest write), enough for a migration. */
function fakeServer(): RemoteApi {
  const rows = new Map<string, RemoteRow>()
  return {
    async upsert(list) {
      for (const r of list) rows.set(`${r.collection}:${r.id}`, r)
    },
    async fetch(collection, ids) {
      return ids.map((id) => rows.get(`${collection}:${id}`)).filter((x): x is RemoteRow => Boolean(x))
    },
    async pullSince() {
      return []
    },
    async saveSettings() {},
    async loadSettings() {
      return null
    },
  }
}

describe('A1: senhas da cópia sem conta depois da migração', () => {
  it('a migração conferida tira as senhas em texto puro do aparelho e registra o que foi enviado', async () => {
    await seed(LOCAL_DB, { accounts: [account('ac1', 'segredo123'), account('ac2', '')] as unknown as Entity[], notes: [note('n1')] }, { settings: settings() })
    const sealAccount = async (a: Account): Promise<Account> => ({ ...a, password: '', secret: a.password ? { v: 1, iv: 'iv', ct: 'ct' } : null })
    await migrateLocalToAccount({ uid: 'user-a', remote: fakeServer(), plan: { settings: 'copy', moveTransactions: false, initialAsAdjustment: false }, accountSettings: null, sealAccount })

    const after = await local()
    expect(after.data.accounts.every((a) => a.password === '')).toBe(true)
    // Nothing else of the local copy is touched by the migration itself.
    expect(after.data.notes.map((n) => n.id)).toEqual(['n1'])
    const mark = after.marks.find((m) => m.uid === 'user-a')!
    expect(mark.settingsCopied).toBe(true)
    expect(mark.sent).toContain('accounts')
    expect(mark.sent).not.toContain('transactions')
    expect((await readLocal()).migratedTo).toEqual(['user-a'])
  })
})

describe('A2: ao fim da sessão, nada da conta fica no aparelho', () => {
  it('apaga o banco da conta, as preferências da conta e a sessão; mantém tema e filtros do aparelho', async () => {
    await seed(cacheDbName('user-a'), { notes: [note('a-1', T0, 'Nota privada da A')] }, { settings: settings() }, ['notes:a-2'])
    rememberAccountOnDevice('user-a')
    for (const [k, v] of Object.entries({ 'nucleo:auth': '{"token":"x"}', 'nucleo:auth-user': '{}', 'nucleo:focusTimer': '{"taskId":"t1"}', 'nucleo:shownReminders': '{}', 'nucleo:displayCurrency': '"BRL"', 'nucleo:theme': '"dark"', 'nucleo:tasks.tab': '"todo"' })) localStorage.setItem(k, v)

    const { pendingLost } = await removeAccountFromDevice('user-a', { wholeDevice: true })

    expect(pendingLost).toBe(1)
    expect(await exists(cacheDbName('user-a'))).toBe(false)
    for (const k of ['nucleo:auth', 'nucleo:auth-user', 'nucleo:focusTimer', 'nucleo:shownReminders', 'nucleo:displayCurrency']) expect(localStorage.getItem(k)).toBeNull()
    expect(localStorage.getItem('nucleo:theme')).toBe('"dark"')
    expect(localStorage.getItem('nucleo:tasks.tab')).toBe('"todo"')
    expect(await accountsOnDevice()).toEqual([])
  })

  it('remove da cópia sem conta só o que já está na conta; o que nunca foi enviado continua', async () => {
    const mark: MigrationMark = { uid: 'user-a', at: MIGRATED_AT, sent: ['notes', 'accounts'], settingsCopied: true }
    await seed(
      LOCAL_DB,
      {
        notes: [note('enviada', T0), note('editada-depois', LATER), note('criada-depois', LATER)],
        accounts: [account('ac1', '')] as unknown as Entity[],
        // Movements were skipped by that migration (different base currency): they exist only here.
        transactions: [{ id: 'mov-so-aqui', createdAt: T0, updatedAt: T0 } as Entity, { id: 'mov-na-conta', createdAt: T0, updatedAt: T0 } as Entity],
      },
      { settings: settings({ updatedAt: T0 }), migratedTo: [mark] },
    )
    // The account's cache has one of the movements, already on the server (not pending).
    await seed(cacheDbName('user-a'), { transactions: [{ id: 'mov-na-conta', createdAt: T0, updatedAt: LATER } as Entity] })

    await removeAccountFromDevice('user-a', { wholeDevice: true })

    const after = await local()
    expect(after.data.notes.map((n) => n.id).sort()).toEqual(['criada-depois', 'editada-depois'])
    expect(after.data.accounts).toEqual([])
    expect(after.data.transactions.map((t) => t.id)).toEqual(['mov-so-aqui'])
    // Copied to the account by the migration and unchanged since: removed too.
    expect(after.settings).toBeNull()
  })

  it('não toca na cópia sem conta quando ela não foi enviada para essa conta (recusou ou foi para outra)', async () => {
    const other: MigrationMark = { uid: 'user-b', at: MIGRATED_AT, sent: ['notes'], settingsCopied: true }
    await seed(LOCAL_DB, { notes: [note('do-aparelho')] }, { settings: settings(), migratedTo: [other] })
    await seed(cacheDbName('user-a'), { notes: [note('a-1')] })

    await removeAccountFromDevice('user-a', { wholeDevice: true })

    const after = await local()
    expect(after.data.notes.map((n) => n.id)).toEqual(['do-aparelho'])
    expect(after.settings).not.toBeNull()
  })

  it('mudança da cópia sem conta que ainda não chegou ao servidor da conta não conta como "já está na conta"', async () => {
    const mark: MigrationMark = { uid: 'user-a', at: MIGRATED_AT, sent: [] }
    await seed(LOCAL_DB, { notes: [note('n1', T0)] }, { migratedTo: [mark] })
    await seed(cacheDbName('user-a'), { notes: [note('n1', LATER)] }, {}, ['notes:n1'])

    await removeAccountFromDevice('user-a', { wholeDevice: true })

    expect((await local()).data.notes.map((n) => n.id)).toEqual(['n1'])
  })

  it('migração de versão antiga (sem lista do que foi enviado): remove tudo menos movimentações não confirmadas', async () => {
    await seed(LOCAL_DB, { notes: [note('n1')], transactions: [{ id: 'm1', createdAt: T0, updatedAt: T0 } as Entity] }, { settings: settings(), migratedTo: [{ uid: 'user-a', at: MIGRATED_AT }] })

    await removeAccountFromDevice('user-a', { wholeDevice: true })

    const after = await local()
    expect(after.data.notes).toEqual([])
    expect(after.data.transactions.map((t) => t.id)).toEqual(['m1'])
    // It isn't known whether the old migration copied the settings: they stay.
    expect(after.settings).not.toBeNull()
  })

  it('com outra conta já conectada (outra aba), só o que é da conta antiga sai', async () => {
    await seed(cacheDbName('user-a'), { notes: [note('a-1')] })
    await seed(cacheDbName('user-b'), { notes: [note('b-1')] })
    rememberAccountOnDevice('user-a')
    rememberAccountOnDevice('user-b')
    localStorage.setItem('nucleo:auth', '{"user":"b"}')
    localStorage.setItem('nucleo:focusTimer', '{"taskId":"b-task"}')

    await removeAccountFromDevice('user-a', { wholeDevice: false })

    expect(await exists(cacheDbName('user-a'))).toBe(false)
    expect(await exists(cacheDbName('user-b'))).toBe(true)
    expect(localStorage.getItem('nucleo:auth')).toBe('{"user":"b"}')
    expect(localStorage.getItem('nucleo:focusTimer')).toBe('{"taskId":"b-task"}')
    expect(await accountsOnDevice()).toEqual(['user-b'])
  })

  it('encontra sobras de conta pela lista de bancos do aparelho, mesmo sem o registro', async () => {
    await seed(cacheDbName('user-x'), { notes: [note('x-1')] })
    expect(localStorage.getItem('nucleo:accountsOnDevice')).toBeNull()
    expect(await accountsOnDevice()).toEqual(['user-x'])
  })

  it('não cria bancos ao limpar uma conta que não deixou nada no aparelho', async () => {
    await removeAccountFromDevice('user-z', { wholeDevice: true })
    expect((await indexedDB.databases()).map((d) => d.name)).toEqual([])
  })
})
