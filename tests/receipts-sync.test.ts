import 'fake-indexeddb/auto'
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { projectReceipts, receiptOps, type ReceiptCtx } from '../src/data/receipts'
import type { BatchOp } from '../src/data/repository'
import { balanceOf } from '../src/data/selectors'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { Project, Settings, Transaction } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'

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

const settings = { baseCurrency: 'EUR', timeZone: 'Europe/Madrid', initialBalance: 0 } as Settings
const ctx: ReceiptCtx = { settings, convert: makeConverter({ EUR: 1, BRL: 6 }) }
const base: Project = {
  id: 'pc', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', name: 'Perfect Clean', clientId: null, kind: 'site', status: 'done',
  startDate: '2026-09-01', dueDate: '', endDate: '', charged: 40000, received: 0, currency: 'EUR', link: '', notes: '',
}
let n = 0
const device = (api: RemoteApi) => createSyncedRepository(`rcv-${++n}`, api, { autoSync: false })
const stamp = (ops: BatchOp[], at: string): BatchOp[] => ops.map((o) => (o.op === 'put' ? { ...o, item: { ...o.item, updatedAt: at } } : o))

/** What the app does when a payment is saved: project + its income in one batch. */
async function savePayments(repo: ReturnType<typeof device>, before: Project, after: Project, at: string) {
  const { data } = await repo.load()
  const ops: BatchOp[] = [{ op: 'put', collection: 'projects', item: { ...after, updatedAt: at } }, ...receiptOps(projectReceipts(before), projectReceipts(after), data.transactions, ctx)]
  await repo.batch(stamp(ops, at))
}

describe('recebimentos com sincronização', () => {
  it('offline: projeto e entrada ficam no aparelho; ao reconectar sobe UMA entrada', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    await phone.load()
    s.setOffline(true)
    const paid = { ...base, payments: [{ id: 'p1', date: '2026-10-05', amount: 20000, currency: 'EUR', note: '' }] }
    await savePayments(phone, base, paid, '2026-10-01T10:00:00.000Z')
    const local = await phone.load()
    expect(local.data.transactions.map((t) => t.id)).toEqual(['rcv-project-p1'])
    expect(balanceOf(settings, local.data.transactions)).toBe(20000)
    await expect(phone.flush()).rejects.toThrow()
    expect(s.live('transactions')).toHaveLength(0)

    s.setOffline(false)
    await phone.flush()
    await phone.flush()
    await phone.pull()
    expect(s.live('transactions').map((r) => r.id)).toEqual(['rcv-project-p1'])
    expect((await phone.load()).data.transactions).toHaveLength(1)
  })

  it('dois aparelhos, sync repetido e reenvio da mesma operação: continua uma entrada', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.load()
    const paid = { ...base, payments: [{ id: 'p1', date: '2026-10-05', amount: 20000, currency: 'EUR', note: '' }] }
    await savePayments(phone, base, paid, '2026-10-01T10:00:00.000Z')
    await phone.flush()
    await laptop.load()
    expect((await laptop.load()).data.transactions.map((t) => t.id)).toEqual(['rcv-project-p1'])

    // The same operation sent again (retry) on both devices, plus repeated syncs.
    await savePayments(phone, base, paid, '2026-10-01T10:00:01.000Z')
    await savePayments(laptop, base, paid, '2026-10-01T10:00:02.000Z')
    for (const d of [phone, laptop, phone, laptop]) {
      await d.flush()
      await d.pull()
    }
    expect(s.live('transactions')).toHaveLength(1)
    expect((await phone.load()).data.transactions).toHaveLength(1)
    expect((await laptop.load()).data.transactions).toHaveLength(1)
  })

  it('editar offline e excluir em outro aparelho: a mesma entrada muda e depois sai', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.load()
    const v1 = { ...base, payments: [{ id: 'p1', date: '2026-10-05', amount: 20000, currency: 'EUR', note: '' }] }
    await savePayments(phone, base, v1, '2026-10-01T10:00:00.000Z')
    await phone.flush()
    await laptop.load()

    // Laptop offline: corrects 200 → 150.
    s.setOffline(true)
    const v2 = { ...v1, payments: [{ ...v1.payments[0], amount: 15000 }] }
    await savePayments(laptop, v1, v2, '2026-10-01T11:00:00.000Z')
    expect((await laptop.load()).data.transactions[0].amount).toBe(15000)
    s.setOffline(false)
    await laptop.flush()
    await phone.pull()
    const onPhone = (await phone.load()).data
    expect(onPhone.transactions).toHaveLength(1)
    expect(onPhone.transactions[0]).toMatchObject({ id: 'rcv-project-p1', amount: 15000 })
    expect(onPhone.projects[0].payments![0].amount).toBe(15000)

    // Phone offline: deletes the payment; the income goes with it everywhere.
    s.setOffline(true)
    await savePayments(phone, v2, { ...v2, payments: [] }, '2026-10-01T12:00:00.000Z')
    expect((await phone.load()).data.transactions).toHaveLength(0)
    s.setOffline(false)
    await phone.flush()
    await laptop.pull()
    expect(s.live('transactions')).toHaveLength(0)
    expect((await laptop.load()).data.transactions).toHaveLength(0)
    expect(balanceOf(settings, (await laptop.load()).data.transactions as Transaction[])).toBe(0)
  })

  it('conflito: edição atrasada de um aparelho não sobrescreve a mais nova', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.load()
    const v1 = { ...base, payments: [{ id: 'p1', date: '2026-10-05', amount: 20000, currency: 'EUR', note: '' }] }
    await savePayments(phone, base, v1, '2026-10-01T10:00:00.000Z')
    await phone.flush()
    await laptop.load()
    // Newer edit on the phone (150), older one from the laptop (180) arrives later.
    await savePayments(phone, v1, { ...v1, payments: [{ ...v1.payments[0], amount: 15000 }] }, '2026-10-01T12:00:00.000Z')
    await phone.flush()
    await savePayments(laptop, v1, { ...v1, payments: [{ ...v1.payments[0], amount: 18000 }] }, '2026-10-01T11:00:00.000Z')
    await laptop.flush()
    await laptop.pull()
    expect(s.live('transactions')[0].data).toMatchObject({ amount: 15000 })
    const onLaptop = (await laptop.load()).data
    expect(onLaptop.transactions[0].amount).toBe(15000)
    expect(onLaptop.projects[0].payments![0].amount).toBe(15000)
  })

  it('lote: projeto e entrada vão juntos para a fila de envio', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    await phone.load()
    await savePayments(phone, base, { ...base, payments: [{ id: 'p1', date: '2026-10-05', amount: 100, currency: 'EUR', note: '' }] }, '2026-10-01T10:00:00.000Z')
    expect(await phone.pendingCount()).toBe(2)
    await phone.flush()
    expect(await phone.pendingCount()).toBe(0)
    expect(s.live('projects')).toHaveLength(1)
    expect(s.live('transactions')).toHaveLength(1)
  })
})

describe('isolamento entre contas no banco real (RLS)', () => {
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  let db: PGlite
  async function as(user: string, sql: string, params: unknown[] = []) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
    await db.exec('set role authenticated')
    try {
      return await db.query<Record<string, unknown>>(sql, params)
    } finally {
      await db.exec('reset role')
    }
  }
  const upsert = `insert into records (collection, id, data, client_updated_at) values ($1, $2, $3, $4)
                  on conflict (user_id, collection, id) do update set data = excluded.data, client_updated_at = excluded.client_updated_at`

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`)
    for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
    await db.query(`insert into auth.users (id) values ($1), ($2)`, [A, B])
  }, 60_000)

  it('pagamento e entrada de A não aparecem para B; mesmo id em B não mexe nos de A; reenviar não duplica', async () => {
    const project = { ...base, payments: [{ id: 'p1', date: '2026-10-05', amount: 20000, currency: 'EUR', note: '' }] }
    const tx = { id: 'rcv-project-p1', type: 'in', amount: 20000, currency: 'EUR', baseAmount: 20000, reason: 'Perfect Clean · Pagamento de projeto', source: { kind: 'project', parentId: 'pc', paymentId: 'p1' } }
    for (let i = 0; i < 3; i++) {
      await as(A, upsert, ['projects', 'pc', project, '2026-10-05T10:00:00Z'])
      await as(A, upsert, ['transactions', 'rcv-project-p1', tx, '2026-10-05T10:00:00Z'])
    }
    expect((await as(A, `select id from records where collection = 'transactions'`)).rows).toHaveLength(1)
    expect((await as(B, `select id from records`)).rows).toHaveLength(0)
    await as(B, upsert, ['transactions', 'rcv-project-p1', { ...tx, amount: 1 }, '2026-10-05T11:00:00Z'])
    expect((await as(A, `select data from records where id = 'rcv-project-p1'`)).rows[0].data).toMatchObject({ amount: 20000 })
    expect((await as(B, `select data from records where id = 'rcv-project-p1'`)).rows[0].data).toMatchObject({ amount: 1 })
    expect((await as(B, `update records set data = '{}' where user_id = $1`, [A])).affectedRows).toBe(0)
  })
})
