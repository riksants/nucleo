import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { isEnabled } from '../src/app/modules'
import { applyGeneralPayment, buyerPayments, buyers, salePaid, withPayment } from '../src/data/sales'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { MealEntry, Payment, Sale, Settings } from '../src/data/types'

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
  return { api, rows, state, settings: () => settings }
}

const at = (h: number, m = 0) => `2026-10-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`
let seq = 0
const pid = () => `pay${++seq}`
const sale = (id: string, over: Partial<Sale> = {}, when = at(9)): Sale => ({
  id,
  createdAt: when,
  updatedAt: when,
  clientId: null,
  clientName: 'Maria',
  product: id,
  quantity: 1,
  date: '2026-09-01',
  total: 30000,
  currency: 'BRL',
  dueDate: '',
  payments: [],
  notes: '',
  ...over,
})
const pay = (amount: number, over: Partial<Payment> = {}): Payment => ({ id: pid(), date: '2026-10-01', amount, note: '', ...over })
const stamp = (s: Sale, when: string): Sale => ({ ...s, updatedAt: when })

describe('Vendas offline e sincronização', () => {
  it('venda, pagamento específico e pagamento geral offline: sobem ao reconectar, sem duplicar', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('sales-u1', server.api, { autoSync: false })
    await phone.load()
    server.state.offline = true
    const tenis = sale('tenis', { date: '2026-09-01' })
    const camisa = sale('camisa', { date: '2026-09-05', total: 10000 })
    await phone.put('sales', tenis)
    await phone.put('sales', camisa)
    const tenisPaid = stamp(withPayment(tenis, pay(5000)), at(10))
    await phone.put('sales', tenisPaid)
    const r = applyGeneralPayment([tenisPaid, camisa], { generalId: 'g1', currency: 'BRL', amount: 30000, date: '2026-10-02', note: 'Pix' }, pid)
    if ('error' in r) throw new Error(r.error)
    for (const s of r.changed) await phone.put('sales', stamp(s, at(11)))
    await phone.flush().catch(() => {})
    expect(server.rows.size).toBe(0)
    // Offline the phone still shows everything.
    const local = (await phone.load()).data.sales
    expect(buyers(local, (s) => s.clientName)[0].totals[0]).toMatchObject({ total: 40000, paid: 35000, remaining: 5000 })

    server.state.offline = false
    await phone.flush()
    await phone.flush() // sending again never duplicates
    expect(await phone.pendingCount()).toBe(0)
    expect([...server.rows.keys()].sort()).toEqual(['sales:camisa', 'sales:tenis'])
    const onServer = [...server.rows.values()].map((x) => x.data as Sale)
    expect(onServer.reduce((sum, s) => sum + salePaid(s), 0)).toBe(35000)
    const history = buyerPayments(onServer)
    expect(history.filter((e) => e.kind === 'general')).toHaveLength(1)
    expect(history.filter((e) => e.kind === 'specific')).toHaveLength(1)
  })

  it('outro aparelho recebe as vendas e pagamentos com o mesmo total', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('sales-u2-phone', server.api, { autoSync: false })
    await phone.load()
    const r = applyGeneralPayment([sale('a', { total: 20000 }), sale('b', { total: 30000, date: '2026-09-09' })], { generalId: 'g', currency: 'BRL', amount: 20000, date: '2026-10-02', note: '' }, pid)
    if ('error' in r) throw new Error(r.error)
    for (const s of r.changed) await phone.put('sales', stamp(s, at(10)))
    await phone.put('sales', sale('b', { total: 30000, date: '2026-09-09' }))
    await phone.flush()
    const pc = createSyncedRepository('sales-u2-pc', server.api, { autoSync: false })
    const onPc = (await pc.load()).data.sales
    expect(buyers(onPc, (s) => s.clientName)[0].totals[0]).toMatchObject({ total: 50000, paid: 20000, remaining: 30000 })
  })

  it('dois aparelhos em compras diferentes da mesma pessoa: nada se perde', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('sales-u3-phone', server.api, { autoSync: false })
    await phone.load()
    await phone.put('sales', sale('a'))
    await phone.put('sales', sale('b', { date: '2026-09-02' }))
    await phone.flush()
    const pc = createSyncedRepository('sales-u3-pc', server.api, { autoSync: false })
    await pc.load()
    server.state.offline = true
    await phone.put('sales', stamp(withPayment(sale('a'), pay(10000)), at(10)))
    await pc.put('sales', stamp(withPayment(sale('b', { date: '2026-09-02' }), pay(7000)), at(10, 5)))
    server.state.offline = false
    await phone.flush()
    await pc.flush()
    await phone.pull()
    await pc.pull()
    for (const repo of [phone, pc]) {
      const list = (await repo.load()).data.sales
      expect(list.reduce((sum, s) => sum + salePaid(s), 0)).toBe(17000)
    }
  })

  it('conflito na MESMA compra: fica a última gravação, sem contar em dobro nem passar do total', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('sales-u4-phone', server.api, { autoSync: false })
    await phone.load()
    await phone.put('sales', sale('a'))
    await phone.flush()
    const pc = createSyncedRepository('sales-u4-pc', server.api, { autoSync: false })
    await pc.load()
    server.state.offline = true
    await phone.put('sales', stamp(withPayment(sale('a'), pay(20000)), at(10)))
    await pc.put('sales', stamp(withPayment(sale('a'), pay(25000)), at(11)))
    server.state.offline = false
    await pc.flush()
    await phone.flush() // older write arriving later is ignored
    await phone.pull()
    await pc.pull()
    const a = (await phone.load()).data.sales[0]
    const b = (await pc.load()).data.sales[0]
    expect(salePaid(a)).toBe(25000)
    expect(salePaid(b)).toBe(25000)
    expect(salePaid(a)).toBeLessThanOrEqual(a.total)
    expect(server.rows.size).toBe(1)
  })
})

describe('Seções: preferência sincronizada, dados intactos', () => {
  const base = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: at(8), rates: null, manualRates: {}, lastBackupAt: null } as Settings

  it('desativar e reativar uma seção não apaga nada e vale nos dois aparelhos', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('mods-u1-phone', server.api, { autoSync: false })
    await phone.load()
    await phone.saveSettings({ ...base, modules: { sales: true, meals: true }, updatedAt: at(9) })
    await phone.put('sales', sale('a'))
    const meal: MealEntry = { id: 'm1', createdAt: at(9), updatedAt: at(9), date: '2026-10-01', type: '', name: 'Almoço', time: '12:30', description: '', ingredients: [], notes: '', done: false, doneAt: null }
    await phone.put('meals', meal)
    await phone.flush()

    // Turn Vendas and Alimentação off (offline), then reconnect.
    server.state.offline = true
    await phone.saveSettings({ ...base, modules: { sales: false, meals: false }, updatedAt: at(10) })
    await phone.flush().catch(() => {})
    let local = await phone.load()
    expect(isEnabled(local.settings!, 'sales')).toBe(false)
    expect(local.data.sales).toHaveLength(1)
    expect(local.data.meals).toHaveLength(1)
    server.state.offline = false
    await phone.flush()
    expect(server.settings()?.data.modules).toEqual({ sales: false, meals: false })
    expect(server.rows.size).toBe(2)

    const pc = createSyncedRepository('mods-u1-pc', server.api, { autoSync: false })
    const onPc = await pc.load()
    await pc.pull()
    const pcSettings = (await pc.load()).settings ?? onPc.settings
    expect(isEnabled(pcSettings!, 'sales')).toBe(false)

    // Back on: everything is exactly where it was.
    await phone.saveSettings({ ...base, modules: { sales: true, meals: true }, updatedAt: at(11) })
    await phone.flush()
    await pc.pull()
    local = await pc.load()
    expect(isEnabled(local.settings!, 'sales')).toBe(true)
    expect(local.data.sales.map((s) => s.id)).toEqual(['a'])
    expect(local.data.meals.map((m) => m.id)).toEqual(['m1'])
  })

  it('usuário existente sem escolha salva continua como estava', () => {
    // Older sections stay on, newer ones off — no automatic change.
    expect(isEnabled({}, 'finance')).toBe(true)
    expect(isEnabled({}, 'meals')).toBe(false)
    expect(isEnabled({ modules: { meals: true } }, 'meals')).toBe(true)
    expect(isEnabled({ modules: { finance: false } }, 'finance')).toBe(false)
  })
})
