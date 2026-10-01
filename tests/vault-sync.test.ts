import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { localSummary, migrateLocalToAccount, planMigration } from '../src/data/migration'
import { createIndexedDbRepository } from '../src/data/repository'
import { createSyncedRepository, PlainPasswordError, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { Account, CollectionName, Entity, Settings } from '../src/data/types'
import { buildBackup } from '../src/lib/backup'
import { changeVaultPassword, createVault, open, resetWithRecovery, seal, unlockWithPassword, WrongVaultSecretError } from '../src/lib/vault'

/** In-memory server with the same rules as the SQL: per user, stale writes ignored. */
function fakeServer() {
  const rows = new Map<string, RemoteRow & { server_updated_at: string }>()
  let settings: { data: Settings; updatedAt: string } | null = null
  let clock = 0
  const stamp = () => new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString()
  const api: RemoteApi = {
    async upsert(list) {
      for (const r of list) {
        const key = `${r.collection}:${r.id}`
        const old = rows.get(key)
        if (old && r.client_updated_at < old.client_updated_at) continue
        rows.set(key, { ...r, server_updated_at: stamp() })
      }
    },
    async fetch(collection, ids) {
      return ids.map((id) => rows.get(`${collection}:${id}`)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    },
    async pullSince(cursor, limit) {
      return [...rows.values()].filter((r) => !cursor || r.server_updated_at > cursor).sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1)).slice(0, limit)
    },
    async saveSettings(data, updatedAt) {
      if (!settings || settings.updatedAt <= updatedAt) settings = { data, updatedAt }
    },
    async loadSettings() {
      return settings
    },
  }
  return { api, rows, getSettings: () => settings }
}

const entity = <T extends object>(id: string, body: T, at = '2026-09-01T10:00:00.000Z') => ({ id, createdAt: at, updatedAt: at, ...body }) as Entity & T

describe('cofre', () => {
  it('cifra, abre e não abre com senha errada', async () => {
    const { meta, key, recoveryCode } = await createVault('senha-do-cofre-1', true)
    const sealed = await seal(key, 'minha senha 123')
    expect(sealed.ct).not.toContain('minha')
    expect(JSON.stringify(meta)).not.toContain('senha-do-cofre-1')
    expect(await open(await unlockWithPassword(meta, 'senha-do-cofre-1'), sealed)).toBe('minha senha 123')
    await expect(unlockWithPassword(meta, 'errada-errada')).rejects.toBeInstanceOf(WrongVaultSecretError)

    // código de recuperação define nova senha e mantém os dados
    const rec = await resetWithRecovery(meta, recoveryCode!.toLowerCase(), 'nova-senha-cofre')
    expect(await open(rec.key, sealed)).toBe('minha senha 123')
    await expect(unlockWithPassword(rec.meta, 'senha-do-cofre-1')).rejects.toThrow()

    const changed = await changeVaultPassword(rec.meta, 'nova-senha-cofre', 'outra-senha-cofre')
    expect(await open(changed.key, sealed)).toBe('minha senha 123')
  }, 30_000)

  it('a chave aberta não pode ser exportada', async () => {
    const { key } = await createVault('senha-do-cofre-1', false)
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  }, 30_000)

  it('backup nunca leva senha em texto aberto', async () => {
    const { key } = await createVault('senha-do-cofre-1', false)
    const plain = entity('a1', { name: 'Banco', password: 'texto-aberto', secret: null }) as unknown as Account
    const sealedAcc = entity('a2', { name: 'Email', password: '', secret: await seal(key, 'cifrada') }) as unknown as Account
    const empty = { transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [plain, sealedAcc], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [] }
    const { blob, omittedPasswords } = buildBackup(empty, { onboarded: true } as Settings)
    const text = await blob.text()
    expect(omittedPasswords).toBe(1)
    expect(text).not.toContain('texto-aberto')
    expect(text).not.toContain('cifrada')
  }, 30_000)
})

describe('sincronização', () => {
  it('não aceita senha em texto aberto para enviar ao servidor', async () => {
    const repo = createSyncedRepository('u-plain', fakeServer().api, { autoSync: false })
    await expect(repo.put('accounts', entity('a', { name: 'x', password: '123' }) as unknown as Account)).rejects.toBeInstanceOf(PlainPasswordError)
  })

  it('dois aparelhos da mesma conta convergem e exclusões propagam', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('u1', server.api, { autoSync: false })
    await phone.load()
    await phone.put('notes', entity('n1', { title: 'A', body: '', pinned: false }) as never)
    await phone.put('notes', entity('n2', { title: 'B', body: '', pinned: false }) as never)
    await phone.flush()
    expect(await phone.pendingCount()).toBe(0)

    // "computador" usa outro cache (outro uid de cache simula outro aparelho)
    const pc = createSyncedRepository('u1-pc', server.api, { autoSync: false })
    const first = await pc.load()
    expect(first.data.notes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])

    await pc.remove('notes', 'n1')
    await pc.flush()
    await phone.pull()
    expect((await phone.load()).data.notes.map((n) => n.id)).toEqual(['n2'])
  })

  it('edição offline não se perde e uma edição atrasada não apaga a mais nova', async () => {
    const server = fakeServer()
    const a = createSyncedRepository('u2-a', server.api, { autoSync: false })
    const b = createSyncedRepository('u2-b', server.api, { autoSync: false })
    await a.load()
    await b.load()
    await a.put('tasks', entity('t', { title: 'velha' }, '2026-09-01T09:00:00.000Z') as never)
    await b.put('tasks', entity('t', { title: 'nova' }, '2026-09-01T12:00:00.000Z') as never)
    await b.flush()
    await a.flush() // chega depois, mas é mais antiga
    await a.pull()
    expect(((await a.load()).data.tasks[0] as unknown as { title: string }).title).toBe('nova')
  })
})

describe('migração local → conta', () => {
  it('envia, confere, não duplica ao repetir e não apaga a cópia local', async () => {
    const local = createIndexedDbRepository('nucleo')
    await local.bulkWrite(
      {
        notes: [entity('n1', { title: 'nota', body: '', pinned: false }) as never],
        tasks: [entity('t1', { title: 'tarefa' }) as never],
        accounts: [entity('a1', { name: 'Banco', password: 'abc123', secret: null }) as never],
        transactions: [entity('x1', { type: 'in', amount: 1000, currency: 'EUR', baseAmount: 1000, reason: 'r' }) as never],
      },
      { onboarded: true, baseCurrency: 'EUR', initialBalance: 5000, startedAt: '2026-09-01', rates: null, manualRates: {}, lastBackupAt: null },
      true,
    )
    const summary = await localSummary()
    expect(summary).toMatchObject({ total: 4, plainPasswords: 1 })

    const server = fakeServer()
    const { key } = await createVault('senha-do-cofre-1', false)
    const sealAccount = async (acc: Account) => (acc.password ? { ...acc, password: '', secret: await seal(key, acc.password) } : acc)
    const plan = planMigration(summary.settings, null)
    const first = await migrateLocalToAccount({ uid: 'u3', remote: server.api, plan, accountSettings: null, sealAccount })
    expect(first.verified).toBe(4)
    expect(server.rows.size).toBe(4)
    const acc = server.rows.get('accounts:a1')!.data as unknown as Account
    expect(acc.password).toBe('')
    expect(await open(key, acc.secret!)).toBe('abc123')
    expect(server.getSettings()?.data.initialBalance).toBe(5000)

    const again = await migrateLocalToAccount({ uid: 'u3', remote: server.api, plan, accountSettings: null, sealAccount })
    expect(again.verified).toBe(4)
    expect(server.rows.size).toBe(4)

    const after = await localSummary()
    expect(after.total).toBe(4)
    expect(after.migratedTo).toContain('u3')
  }, 30_000)

  it('conta já configurada com outra moeda: movimentações ficam no aparelho; saldo inicial vira ajuste só com mesma moeda', () => {
    const local = { onboarded: true, baseCurrency: 'EUR', initialBalance: 5000 } as Settings
    expect(planMigration(local, { onboarded: true, baseCurrency: 'BRL' } as Settings)).toEqual({ settings: 'keep', moveTransactions: false, initialAsAdjustment: false })
    expect(planMigration(local, { onboarded: true, baseCurrency: 'EUR' } as Settings)).toEqual({ settings: 'keep', moveTransactions: true, initialAsAdjustment: true })
    // Second migration to an account that got its settings from this same device: no double starting balance.
    expect(planMigration({ ...local, startedAt: 'x' }, { onboarded: true, baseCurrency: 'EUR', startedAt: 'x' } as Settings).initialAsAdjustment).toBe(false)
    expect(planMigration(local, { onboarded: true, baseCurrency: 'EUR' } as Settings, true).initialAsAdjustment).toBe(false)
  })

  it('falha de verificação não marca o aparelho como migrado', async () => {
    const server = fakeServer()
    const broken: RemoteApi = { ...server.api, fetch: async () => [] }
    const plan = planMigration(null, null)
    await expect(migrateLocalToAccount({ uid: 'u4', remote: broken, plan, accountSettings: null, sealAccount: async (a) => ({ ...a, password: '' }) })).rejects.toThrow(/Verificação falhou/)
    expect((await localSummary()).migratedTo).not.toContain('u4')
  })
})

export type { CollectionName }
