import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { withSaved } from '../src/core/financeGoals'
import { withExtras } from '../src/data/store'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { FinanceGoal, Settings, Transaction } from '../src/data/types'

/** In-memory server with the SQL rules: per user, stale writes ignored. `offline` simulates no network. */
function fakeServer() {
  const rows = new Map<string, RemoteRow & { server_updated_at: string }>()
  let settings: { data: Settings; updatedAt: string } | null = null
  let clock = 0
  const state = { offline: false }
  const net = () => {
    if (state.offline) throw new TypeError('Failed to fetch')
  }
  const stamp = () => new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString()
  const api: RemoteApi = {
    async upsert(list) {
      net()
      for (const r of list) {
        const key = `${r.collection}:${r.id}`
        const old = rows.get(key)
        if (old && r.client_updated_at < old.client_updated_at) continue
        rows.set(key, { ...r, server_updated_at: stamp() })
      }
    },
    async fetch(collection, ids) {
      net()
      return ids.map((id) => rows.get(`${collection}:${id}`)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    },
    async pullSince(cursor, limit) {
      net()
      return [...rows.values()].filter((r) => !cursor || r.server_updated_at > cursor).sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1)).slice(0, limit)
    },
    async saveSettings(data, updatedAt) {
      net()
      if (!settings || settings.updatedAt <= updatedAt) settings = { data, updatedAt }
    },
    async loadSettings() {
      net()
      return settings
    },
  }
  return { api, rows, state }
}

const at = (h: number) => `2026-10-01T${String(h).padStart(2, '0')}:00:00.000Z`
const movement = (id: string, extra: Partial<Transaction>, when = at(9)): Transaction => ({ id, createdAt: when, updatedAt: when, type: 'out', amount: 2500, currency: 'BRL', baseAmount: -2500, reason: 'Lanche', ...extra })
const goal = (saved: number, when: string): FinanceGoal => ({ id: 'fg', createdAt: at(8), updatedAt: when, name: 'Reserva', target: 500000, saved, deadline: '2026-12-31', currency: 'BRL', note: '', status: 'active', history: withSaved(null, saved, '2026-10-01') })

describe('finanças offline e sincronização', () => {
  it('criar, editar, marcar desnecessário e criar meta offline; sobe tudo ao reconectar, sem duplicar', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('fin-u1', server.api, { autoSync: false })
    await phone.load()
    server.state.offline = true
    await phone.put('transactions', movement('t1', {}))
    await phone.put('transactions', withExtras(movement('t1', {}, at(10)), 'out', { category: 'food' }))
    await phone.put('transactions', withExtras(movement('t1', { category: 'food' }, at(11)), 'out', { unnecessary: true }))
    await phone.put('financeGoals', goal(200000, at(11)))
    await phone.flush().catch(() => {})
    expect(server.rows.size).toBe(0)
    expect(await phone.pendingCount()).toBeGreaterThan(0)
    // o aparelho continua mostrando tudo offline
    const local = await phone.load()
    expect(local.data.transactions).toHaveLength(1)
    expect(local.data.transactions[0]).toMatchObject({ category: 'food', unnecessary: true })

    server.state.offline = false
    await phone.flush()
    expect(await phone.pendingCount()).toBe(0)
    expect([...server.rows.keys()].sort()).toEqual(['financeGoals:fg', 'transactions:t1'])
    expect(server.rows.get('transactions:t1')!.data).toMatchObject({ category: 'food', unnecessary: true, baseAmount: -2500 })
  })

  it('dois aparelhos atualizam a mesma meta: fica a última gravação, mesmo que a antiga chegue depois', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('fin-u2-phone', server.api, { autoSync: false })
    const pc = createSyncedRepository('fin-u2-pc', server.api, { autoSync: false })
    await phone.load()
    await pc.load()
    await phone.put('financeGoals', goal(210000, at(10)))
    await pc.put('financeGoals', goal(260000, at(12)))
    await pc.flush()
    await phone.flush() // chega depois, mas foi gravada antes
    await phone.pull()
    await pc.pull()
    const a = (await phone.load()).data.financeGoals[0]
    const b = (await pc.load()).data.financeGoals[0]
    expect(a.saved).toBe(260000)
    expect(b.saved).toBe(260000)
    expect(server.rows.size).toBe(1)
  })

  it('movimentação antiga editada em outro aparelho continua sem categoria e com o mesmo valor', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('fin-u3-phone', server.api, { autoSync: false })
    await phone.load()
    const old = movement('old', {}, '2026-08-01T10:00:00.000Z')
    await phone.put('transactions', old)
    await phone.flush()
    const pc = createSyncedRepository('fin-u3-pc', server.api, { autoSync: false })
    const loaded = (await pc.load()).data.transactions[0]
    expect('category' in loaded || 'unnecessary' in loaded).toBe(false)
    await pc.put('transactions', withExtras({ ...loaded, reason: 'Lanche da tarde', updatedAt: at(9) }, 'out', {}))
    await pc.flush()
    await phone.pull()
    const back = (await phone.load()).data.transactions[0]
    expect(back).toMatchObject({ reason: 'Lanche da tarde', baseAmount: -2500, createdAt: old.createdAt })
    expect('category' in back).toBe(false)
  })
})
