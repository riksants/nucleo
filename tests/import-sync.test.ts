import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { analyze } from '../src/core/import/analyze'
import { planImport } from '../src/core/import/plan'
import { undoImport } from '../src/core/import/undo'
import { safeRulesForWrite } from '../src/core/rules/engine'
import type { BatchOp } from '../src/data/repository'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { AutomationRun, FinanceGoal, Rule, Settings, Transaction } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { baseSettings, T } from './automation-helpers'
import { linesOf } from './import-helpers'

/** In-memory server with the SQL rules (per account, stale writes ignored) and an offline switch. */
function fakeServer() {
  const rows = new Map<string, RemoteRow & { server_updated_at: string }>()
  let clock = 0
  let offline = false
  const down = () => {
    if (offline) throw new Error('Failed to fetch')
  }
  const api: RemoteApi = {
    async upsert(list) {
      down()
      for (const r of list) {
        const key = `${r.collection}:${r.id}`
        const old = rows.get(key)
        if (old && r.client_updated_at < old.client_updated_at) continue
        rows.set(key, { ...r, server_updated_at: new Date(Date.UTC(2026, 9, 5) + ++clock * 1000).toISOString() })
      }
    },
    async fetch(collection, ids) {
      down()
      return ids.map((id) => rows.get(`${collection}:${id}`)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    },
    async pullSince(cursor, limit) {
      down()
      return [...rows.values()].filter((r) => !cursor || r.server_updated_at > cursor).sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1)).slice(0, limit)
    },
    async saveSettings() {},
    async loadSettings() {
      return null
    },
  }
  const live = (collection: string) => [...rows.values()].filter((r) => r.collection === collection && !r.deleted)
  return { api, live, setOffline: (v: boolean) => (offline = v) }
}

const settings: Settings = { ...baseSettings, initialBalance: 0 }
const convert = makeConverter({ EUR: 1 })
const goal: FinanceGoal = { id: 'g1', createdAt: T, updatedAt: T, name: 'Impostos', target: 1000000, saved: 0, deadline: '2027-12-31', currency: 'EUR', note: '', status: 'active', history: [], inBalance: true }
const saveRule: Rule = { id: 'r1', createdAt: T, updatedAt: T, name: 'Guarde 10%', on: true, since: '2026-10-01', order: 0, trigger: { kind: 'moneyIn' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: 'g1', percent: 10 }] }
const money: Transaction = { id: 'saldo', createdAt: T, updatedAt: T, type: 'in', amount: 1000000, currency: 'EUR', baseAmount: 1000000, reason: 'Saldo' }

const FILE = `Fecha;Concepto;Importe
15/10/2026;MERCADONA VALENCIA;-45,30
16/10/2026;CLIENTE ANA FREELA;1.000,00
17/10/2026;CAFE;-2,00
`

let n = 0
const device = (api: RemoteApi) => createSyncedRepository(`import-${++n}`, api, { autoSync: false })
const stamp = (ops: BatchOp[], at: string): BatchOp[] => ops.map((o) => (o.op === 'put' ? { ...o, item: { ...o.item, updatedAt: at } } : o))

/** The import as the screen does it on one device: read, analyze, plan, rules in the same write. */
async function importOn(repo: ReturnType<typeof device>, id: string, at: string) {
  const { data } = await repo.load()
  const now = new Date(at)
  const ctx = { settings, today: '2026-10-19', convert, now }
  const analysis = analyze(linesOf(FILE), { account: 'Sabadell', currency: 'EUR' }, data, ctx)
  const plan = planImport(analysis, new Map(), { importId: id, file: 'extrato.csv', format: 'csv', account: 'Sabadell' }, data, ctx)
  if (typeof plan === 'string') throw new Error(plan)
  const all = [...plan.ops, ...safeRulesForWrite(data, settings, convert, plan.ops, 'person', now, plan.rules)]
  await repo.batch(stamp(all, at))
  return analysis
}

async function syncAll(...ds: ReturnType<typeof device>[]) {
  for (const d of [...ds, ...ds]) {
    await d.flush()
    await d.pull()
  }
}

async function setup() {
  const s = fakeServer()
  const phone = device(s.api)
  const laptop = device(s.api)
  await phone.load()
  await phone.batch([{ op: 'put', collection: 'financeGoals', item: goal }, { op: 'put', collection: 'rules', item: saveRule }, { op: 'put', collection: 'transactions', item: money }])
  await phone.flush()
  await laptop.load()
  await laptop.pull()
  return { s, phone, laptop }
}

describe('importação com sincronização', () => {
  it('importar offline: grava no aparelho, sobe depois, e o outro aparelho reconhece tudo como duplicado', async () => {
    const { s, phone, laptop } = await setup()
    s.setOffline(true)
    const a = await importOn(phone, 'import-phone', '2026-10-19T09:00:00.000Z')
    expect(a.counts.new).toBe(3)
    expect((await phone.load()).data.transactions).toHaveLength(4)
    expect(s.live('transactions')).toHaveLength(1)
    s.setOffline(false)
    await syncAll(phone, laptop)
    expect(s.live('transactions')).toHaveLength(4)
    expect(s.live('automationRuns').map((r) => (r.data as AutomationRun).automation).sort()).toEqual(['bankImport', 'rule'])
    // The laptop gets the same file: nothing new, nothing runs again.
    const again = await importOn(laptop, 'import-laptop', '2026-10-19T10:00:00.000Z')
    expect(again.counts).toMatchObject({ new: 0, duplicate: 3 })
    await syncAll(phone, laptop)
    expect(s.live('transactions')).toHaveLength(4)
    expect(s.live('automationRuns').filter((r) => (r.data as AutomationRun).automation === 'rule')).toHaveLength(1)
    expect((s.live('financeGoals')[0].data as FinanceGoal).saved).toBe(10000)
  })

  it('o mesmo arquivo nos dois aparelhos offline ao mesmo tempo: as linhas convergem (ids fixos), nada duplica', async () => {
    const { s, phone, laptop } = await setup()
    s.setOffline(true)
    await importOn(phone, 'import-phone', '2026-10-19T09:00:00.000Z')
    await importOn(laptop, 'import-laptop', '2026-10-19T09:00:05.000Z')
    s.setOffline(false)
    await syncAll(phone, laptop)
    expect(s.live('transactions')).toHaveLength(4)
    // The same rule run (fixed id) on both: one reservation, not two.
    expect(s.live('automationRuns').filter((r) => (r.data as AutomationRun).automation === 'rule')).toHaveLength(1)
    expect((s.live('financeGoals')[0].data as FinanceGoal).saved).toBe(10000)
    const { data } = await laptop.load()
    expect(data.transactions).toHaveLength(4)
    // Each movement belongs to one import (the newest write): undoing the other removes nothing of it.
    const owner = data.transactions.find((t) => t.bank)!.bank!.importId
    const other = data.automationRuns.find((r) => r.automation === 'bankImport' && r.id !== owner)!
    expect(undoImport(other, data, '2026-10-19')!.removed).toBe(0)
    const winner = data.automationRuns.find((r) => r.id === owner)!
    expect(undoImport(winner, data, '2026-10-19')!.removed).toBe(3)
  })

  it('desfazer a importação num aparelho remove também no outro', async () => {
    const { phone, laptop } = await setup()
    await importOn(phone, 'import-phone', '2026-10-19T09:00:00.000Z')
    await syncAll(phone, laptop)
    const { data } = await laptop.load()
    const run = data.automationRuns.find((r) => r.id === 'import-phone')!
    const u = undoImport(run, data, '2026-10-19')!
    await laptop.batch(stamp(u.ops, '2026-10-19T11:00:00.000Z'))
    await syncAll(phone, laptop)
    const back = await phone.load()
    expect(back.data.transactions.map((t) => t.id)).toEqual(['saldo'])
    expect(back.data.financeGoals[0].saved).toBe(0)
    expect(back.data.automationRuns.find((r) => r.id === 'import-phone')?.status).toBe('undone')
  })
})
