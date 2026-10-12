import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { planAll } from '../src/core/automation/engine'
import { confirmSubscriberCharge } from '../src/core/automation/subscriberCharge'
import type { BatchOp } from '../src/data/repository'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { Settings, SubPlan, Subscriber, Tool } from '../src/data/types'
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

const settings: Settings = {
  ...baseSettings,
  automations: { subscriberCharge: { on: true, since: '2026-10-01' }, toolCharge: { on: true, since: '2026-10-01' }, projectClient: { on: true, since: '2026-10-01' }, goalSave: { on: true, since: '2026-10-01' } },
}
const convert = makeConverter({ EUR: 1 })
const plan: SubPlan = { id: 'p1', createdAt: T, updatedAt: T, offeringId: 'o1', name: 'Pro', price: 5000, currency: 'EUR', interval: 'monthly' }
const sub = (over: Partial<Subscriber> = {}): Subscriber => ({
  id: 's1', createdAt: T, updatedAt: T, offeringId: 'o1', planId: 'p1', name: 'Ana', clientId: null, email: '', startDate: '2026-01-05',
  nextCharge: '2026-10-05', status: 'active', cancelledAt: '', payments: [], notes: '', ...over,
})
const tool: Tool = { id: 't1', createdAt: T, updatedAt: T, name: 'Figma', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: '2026-10-05', notes: '', status: 'active', autoPaid: true }

let n = 0
const device = (api: RemoteApi) => createSyncedRepository(`auto-${++n}`, api, { autoSync: false })
const stamp = (ops: BatchOp[], at: string): BatchOp[] => ops.map((o) => (o.op === 'put' ? { ...o, item: { ...o.item, updatedAt: at } } : o))

/** One pass of the engine on a device, the way the app runs it. */
async function pass(repo: ReturnType<typeof device>, today: string, at: string) {
  const { data } = await repo.load()
  const ops = planAll({ data, settings, today, convert, now: new Date(at) }).flatMap((p) => p.ops)
  if (ops.length) await repo.batch(stamp(ops, at))
}

describe('automações com sincronização', () => {
  it('dois aparelhos rodam a mesma passada (um deles offline): uma execução, um pagamento, uma entrada', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.load()
    await phone.batch([
      { op: 'put', collection: 'subPlans', item: plan },
      { op: 'put', collection: 'subscribers', item: sub({ paymentMode: 'autoPaid' }) },
      { op: 'put', collection: 'tools', item: tool },
    ])
    await phone.flush()
    await laptop.load()
    await laptop.pull()

    s.setOffline(true)
    await pass(phone, '2026-10-06', '2026-10-06T08:00:00.000Z')
    await pass(laptop, '2026-10-06', '2026-10-06T08:00:05.000Z')
    s.setOffline(false)
    for (const d of [phone, laptop, phone, laptop]) {
      await d.flush()
      await d.pull()
    }
    expect(s.live('automationRuns')).toHaveLength(2)
    expect(s.live('transactions').map((r) => r.id).sort()).toEqual(['rcv-subscriber-auto-sub-s1-2026-10-05', 'tx-auto-tool-t1-2026-10-05'])
    const subs = s.live('subscribers')
    expect((subs[0].data as Subscriber).payments).toHaveLength(1)
    // and after the sync both devices see nothing left to do
    for (const d of [phone, laptop]) {
      const { data } = await d.load()
      expect(planAll({ data, settings, today: '2026-10-06', convert, now: new Date() })).toEqual([])
    }
  })

  it('"A receber" confirmado num aparelho chega ao outro sem duplicar', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.load()
    await phone.batch([{ op: 'put', collection: 'subPlans', item: plan }, { op: 'put', collection: 'subscribers', item: sub() }])
    await pass(phone, '2026-10-05', '2026-10-05T08:00:00.000Z')
    await phone.flush()
    await laptop.load()
    await laptop.pull()
    const { data } = await laptop.load()
    const run = data.automationRuns[0]
    expect(run.status).toBe('pending')
    const ops = confirmSubscriberCharge(run, { amount: 5000, date: '2026-10-07' }, { data, settings, today: '2026-10-07', convert, now: new Date('2026-10-07T09:00:00.000Z') })
    if (typeof ops === 'string') throw new Error(ops)
    await laptop.batch(stamp(ops, '2026-10-07T09:00:00.000Z'))
    await laptop.flush()
    await pass(phone, '2026-10-07', '2026-10-07T09:00:10.000Z')
    await phone.pull()
    await phone.flush()
    expect(s.live('transactions')).toHaveLength(1)
    expect((await phone.load()).data.automationRuns.map((r) => r.status)).toEqual(['done'])
  })
})
