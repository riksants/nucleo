import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { copyWeek } from '../src/core/meals'
import { autoId, buildList } from '../src/core/shopping'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { MealEntry, Settings, ShoppingEntry } from '../src/data/types'

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


const at = (h: number) => `2026-10-07T${String(h).padStart(2, '0')}:00:00.000Z`
const WEEK = '2026-10-05'
const meal = (id: string, p: Partial<MealEntry> = {}, when = at(9)): MealEntry => ({ id, createdAt: at(8), updatedAt: when, date: '2026-10-05', type: 'lunch', name: '', time: '', description: '', ingredients: [], notes: '', done: false, doneAt: null, ...p })
const item = (id: string, p: Partial<ShoppingEntry> = {}, when = at(9)): ShoppingEntry => ({ id, createdAt: at(8), updatedAt: when, week: WEEK, kind: 'manual', name: '', qty: '', unit: '', category: 'Outros', checked: false, note: '', ...p })

describe('alimentação: offline e sincronização', () => {
  it('criar, editar, excluir, marcar realizada, item manual, comprado e copiar semana offline; sobe sem duplicar', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('meal-u1', server.api, { autoSync: false })
    await phone.load()
    server.state.offline = true
    await phone.put('meals', meal('a', { date: '2026-09-28', ingredients: ['3 bananas'] }))
    await phone.put('meals', meal('b', { date: '2026-09-29', type: 'dinner' }))
    await phone.put('meals', meal('a', { date: '2026-09-28', ingredients: ['4 bananas'], done: true, doneAt: at(10) }, at(10)))
    await phone.put('meals', meal('x', { date: '2026-09-30' }))
    await phone.remove('meals', 'x')
    await phone.put('shoppingItems', item('s1', { name: 'Detergente' }))
    await phone.put('shoppingItems', item(autoId('2026-09-28', 'bananas'), { week: '2026-09-28', kind: 'auto', key: 'bananas', name: 'Bananas', checked: true }))
    const local = (await phone.load()).data.meals
    for (const [i, m] of copyWeek(local, '2026-09-28', WEEK).entries()) await phone.put('meals', { ...m, id: `c${i}`, createdAt: at(11), updatedAt: at(11) })
    await phone.flush().catch(() => {})
    expect(server.rows.size).toBe(0)
    server.state.offline = false
    await phone.flush()
    expect(await phone.pendingCount()).toBe(0)
    const keys = [...server.rows.keys()].sort()
    const live = keys.filter((k) => k.startsWith('meals:') && !server.rows.get(k)!.deleted)
    expect(live).toEqual(['meals:a', 'meals:b', 'meals:c0', 'meals:c1'])
    // excluída offline: sobe como exclusão, para os outros aparelhos também removerem
    expect(server.rows.get('meals:x')?.deleted).toBe(true)
    expect(keys.filter((k) => k.startsWith('shoppingItems:')).length).toBe(2)
    expect(server.rows.get('meals:a')!.data).toMatchObject({ done: true, ingredients: ['4 bananas'] })
    // a cópia não leva "realizada"
    expect(server.rows.get('meals:c0')!.data).toMatchObject({ date: '2026-10-05', done: false })
  })

  it('celular marca banana como comprada e computador muda a quantidade na refeição: as duas mudanças ficam', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('meal-u2-phone', server.api, { autoSync: false })
    await phone.load()
    await phone.put('meals', meal('a', { ingredients: ['3 bananas'] }))
    await phone.flush()
    const pc = createSyncedRepository('meal-u2-pc', server.api, { autoSync: false })
    await pc.load()
    await phone.put('shoppingItems', item(autoId(WEEK, 'bananas'), { kind: 'auto', key: 'bananas', name: 'Bananas', checked: true }, at(10)))
    await pc.put('meals', meal('a', { ingredients: ['6 bananas'] }, at(11)))
    await phone.flush()
    await pc.flush()
    await phone.pull()
    await pc.pull()
    for (const repo of [phone, pc]) {
      const d = (await repo.load()).data
      const row = buildList(d.meals, d.shoppingItems, WEEK).find((r) => r.name === 'Bananas')!
      expect(row).toMatchObject({ amount: '6 un', checked: true })
    }
  })

  it('os dois aparelhos marcam o mesmo item automático: um único registro (id fixo)', async () => {
    const server = fakeServer()
    const a = createSyncedRepository('meal-u3-a', server.api, { autoSync: false })
    const b = createSyncedRepository('meal-u3-b', server.api, { autoSync: false })
    await a.load()
    await b.load()
    await a.put('shoppingItems', item(autoId(WEEK, 'arroz'), { kind: 'auto', key: 'arroz', name: 'Arroz', checked: true }, at(10)))
    await b.put('shoppingItems', item(autoId(WEEK, 'arroz'), { kind: 'auto', key: 'arroz', name: 'Arroz', checked: true, category: 'Grãos' }, at(11)))
    await a.flush()
    await b.flush()
    expect([...server.rows.keys()].filter((k) => k.includes('arroz'))).toHaveLength(1)
  })
})
