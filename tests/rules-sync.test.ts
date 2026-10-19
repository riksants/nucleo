import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { safeRulesForWrite } from '../src/core/rules/engine'
import { planScheduledRules } from '../src/core/rules/schedule'
import type { BatchOp } from '../src/data/repository'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { FinanceGoal, Rule, Settings, Transaction } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { baseSettings, T } from './automation-helpers'

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
const mondayRule: Rule = { id: 'r2', createdAt: T, updatedAt: T, name: 'Revisar a semana', on: true, since: '2026-10-01', order: 1, trigger: { kind: 'weekDay', weekdays: [1] }, conditions: [], actions: [{ kind: 'addInbox', text: 'Revisar a semana' }] }
const income = (id: string, at: string): Transaction => ({ id, createdAt: at, updatedAt: at, type: 'in', amount: 100000, currency: 'EUR', baseAmount: 100000, reason: 'Freela' })

let n = 0
const device = (api: RemoteApi) => createSyncedRepository(`rules-${++n}`, api, { autoSync: false })
const stamp = (ops: BatchOp[], at: string): BatchOp[] => ops.map((o) => (o.op === 'put' ? { ...o, item: { ...o.item, updatedAt: at } } : o))

/** A write of the person on a device, the way the store does it (rules added to the same write). */
async function write(repo: ReturnType<typeof device>, ops: BatchOp[], at: string) {
  const { data } = await repo.load()
  const all = [...ops, ...safeRulesForWrite(data, settings, convert, ops, 'person', new Date(at))]
  await repo.batch(stamp(all, at))
}

async function syncAll(...ds: ReturnType<typeof device>[]) {
  for (const d of [...ds, ...ds]) {
    await d.flush()
    await d.pull()
  }
}

describe('regras com sincronização', () => {
  it('entrada registrada offline: a regra roda no aparelho, sobe junto, e o outro aparelho não roda de novo', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.load()
    await phone.batch([{ op: 'put', collection: 'financeGoals', item: goal }, { op: 'put', collection: 'rules', item: saveRule }])
    await phone.flush()
    await laptop.load()
    await laptop.pull()

    s.setOffline(true)
    await write(phone, [{ op: 'put', collection: 'transactions', item: income('tx1', '2026-10-19T09:00:00.000Z') }], '2026-10-19T09:00:00.000Z')
    expect((await phone.load()).data.financeGoals[0].saved).toBe(10000)
    s.setOffline(false)
    await syncAll(phone, laptop)

    const { data } = await laptop.load()
    expect(data.automationRuns.map((r) => r.automation)).toEqual(['rule'])
    expect(data.financeGoals[0].saved).toBe(10000)
    // The same movement written again on the laptop (e.g. edited) is not new: nothing runs.
    await write(laptop, [{ op: 'put', collection: 'transactions', item: { ...income('tx1', '2026-10-19T09:00:00.000Z'), reason: 'Freela (editado)' } }], '2026-10-19T10:00:00.000Z')
    await syncAll(phone, laptop)
    expect(s.live('automationRuns')).toHaveLength(1)
    expect((s.live('financeGoals')[0].data as FinanceGoal).saved).toBe(10000)
  })

  it('regra por data nos dois aparelhos offline: uma execução e um item no Inbox', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.load()
    await phone.batch([{ op: 'put', collection: 'rules', item: mondayRule }])
    await phone.flush()
    await laptop.load()
    await laptop.pull()

    s.setOffline(true)
    for (const [d, at] of [[phone, '2026-10-19T08:00:00.000Z'], [laptop, '2026-10-19T08:00:07.000Z']] as const) {
      const { data } = await d.load()
      const ops = planScheduledRules({ data, settings, today: '2026-10-19', convert, now: new Date(at) })
      await d.batch(stamp(ops, at))
    }
    s.setOffline(false)
    await syncAll(phone, laptop)
    expect(s.live('automationRuns').filter((r) => (r.data as { status: string }).status === 'done')).toHaveLength(1)
    expect(s.live('inbox')).toHaveLength(1)
  })
})
