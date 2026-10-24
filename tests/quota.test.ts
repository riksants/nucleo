/**
 * Account quotas (migration 20261024000000_cotas.sql) on a real Postgres (PGlite), acting as
 * users the same way PostgREST does. Existing rows are created BEFORE the quota migration runs,
 * to check the initial count and that nothing already stored changes.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const QUOTA_FILE = '20261024000000_cotas.sql'
let db: PGlite
let before: string

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  try {
    return await db.query<Record<string, unknown>>(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

const now = () => new Date().toISOString()
const put = (user: string, collection: string, id: string, data: object = {}, deleted = false, at = now()) =>
  as(user, `insert into records (collection, id, data, deleted, client_updated_at) values ($1, $2, $3, $4, $5)
            on conflict (user_id, collection, id) do update set data = excluded.data, deleted = excluded.deleted, client_updated_at = excluded.client_updated_at`,
  [collection, id, JSON.stringify(data), deleted, at])
const setLimit = (key: string, value: number) => db.query('update quota_limits set max_value = $2 where key = $1', [key, value])
const usage = async (user: string, scope: string) =>
  (await db.query<{ live: number; total: number; bytes: number }>('select live::int, total::int, bytes::int from quota_usage where user_id = $1 and scope = $2', [user, scope])).rows[0] ?? { live: 0, total: 0, bytes: 0 }
/** What the usage table should say, counted from scratch. */
const recount = async (user: string) =>
  (await db.query<{ scope: string; live: number; total: number; bytes: number }>(`
    select collection as scope, count(*) filter (where not deleted)::int as live, count(*)::int as total, sum(octet_length(data::text))::int as bytes
      from records where user_id = $1 group by collection
    union all
    select '*', count(*) filter (where not deleted)::int, count(*)::int, coalesce(sum(octet_length(data::text)), 0)::int from records where user_id = $1
    order by scope`, [user])).rows
const stored = async (user: string) =>
  (await db.query<{ scope: string; live: number; total: number; bytes: number }>('select scope, live::int, total::int, bytes::int from quota_usage where user_id = $1 and total > 0 order by scope', [user])).rows
const snapshot = async () =>
  (await db.query<{ h: string }>(`select md5(string_agg(t::text, '|' order by t::text)) as h from (
     select user_id, collection, id, data, deleted, client_updated_at, server_updated_at from records) t`)).rows[0].h

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  const files = readdirSync('supabase/migrations').sort()
  for (const file of files.filter((f) => f !== QUOTA_FILE)) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`)
  await db.query(`insert into auth.users (id) values ($1), ($2), ($3)`, [A, B, C])
  // Data that already exists when the migration is applied (A has items, some deleted; B has nothing).
  for (let i = 0; i < 5; i++) await put(A, 'tasks', `old-${i}`, { title: `Tarefa ${i}` })
  await put(A, 'tasks', 'old-gone', {}, true)
  await put(A, 'portfolio', 'img', { image: 'x'.repeat(5000) })
  await as(A, `insert into scheduled_notifications (key, fire_at, title, body) values ('old', now() + interval '1 day', 'Núcleo', 'Lembrete')`)
  before = await snapshot()
  await db.exec(readFileSync(`supabase/migrations/${QUOTA_FILE}`, 'utf8'))
  await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`)
}, 60_000)

describe('aplicar a migração', () => {
  it('não altera nem apaga nenhum registro existente', async () => {
    expect(await snapshot()).toBe(before)
    expect((await db.query<{ n: number }>('select count(*)::int as n from scheduled_notifications')).rows[0].n).toBe(1)
  })

  it('conta o uso que já existia (itens ativos, apagados e tamanho)', async () => {
    expect(await stored(A)).toEqual(await recount(A))
    expect(await usage(A, 'tasks')).toMatchObject({ live: 5, total: 6 })
    expect(await usage(A, '*')).toMatchObject({ live: 6, total: 7 })
    expect(await stored(B)).toEqual([])
  })

  it('pode rodar de novo sem duplicar contagem nem trocar limites ajustados', async () => {
    await setLimit('records.notes', 1234)
    await db.exec(readFileSync(`supabase/migrations/${QUOTA_FILE}`, 'utf8'))
    expect(await stored(A)).toEqual(await recount(A))
    expect((await db.query<{ v: number }>(`select max_value::int as v from quota_limits where key = 'records.notes'`)).rows[0].v).toBe(1234)
    expect(await snapshot()).toBe(before)
    await setLimit('records.notes', 10000)
  })
})

describe('itens por coleção', () => {
  beforeEach(async () => {
    await db.exec(`reset role; delete from records where user_id in ('${B}', '${C}')`)
    await setLimit('records.notes', 3)
  })

  it('criação normal, até exatamente o limite', async () => {
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id, { title: id })
    expect(await usage(B, 'notes')).toMatchObject({ live: 3, total: 3 })
  })

  it('acima do limite: recusa com 23514 e quota_exceeded, sem gravar nada', async () => {
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id)
    const err = await put(B, 'notes', 'd').catch((e: { code?: string; message: string }) => e)
    expect(err).toMatchObject({ code: '23514', message: 'quota_exceeded:records.notes:3' })
    expect((await as(B, `select id from records where collection = 'notes' order by id`)).rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(await stored(B)).toEqual(await recount(B))
  })

  it('no limite, editar itens existentes continua livre (inclusive pelo upsert do app)', async () => {
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id)
    await put(B, 'notes', 'a', { title: 'editada' })
    expect((await as(B, `update records set data = '{"title":"de novo"}' where id = 'b'`)).affectedRows).toBe(1)
    expect((await as(B, `select data from records where id = 'a'`)).rows[0].data).toEqual({ title: 'editada' })
  })

  it('apagar (lápide do app) libera a vaga na hora; reativar um apagado conta de novo', async () => {
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id)
    await put(B, 'notes', 'a', {}, true)
    expect(await usage(B, 'notes')).toMatchObject({ live: 2, total: 3 })
    await put(B, 'notes', 'd')
    await expect(put(B, 'notes', 'a', { title: 'volta' })).rejects.toMatchObject({ code: '23514' })
    expect(await stored(B)).toEqual(await recount(B))
  })

  it('DELETE de verdade também libera a vaga', async () => {
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id)
    expect((await as(B, `delete from records where id = 'a'`)).affectedRows).toBe(1)
    await put(B, 'notes', 'd')
    expect(await usage(B, 'notes')).toMatchObject({ live: 3, total: 3 })
  })

  it('API direta com muitas linhas num só pedido: recusa o pedido inteiro, nada passa do limite', async () => {
    await put(B, 'notes', 'a')
    const values = ['b', 'c', 'd', 'e'].map((id) => `('notes', '${id}', '{}', '${now()}')`).join(', ')
    await expect(as(B, `insert into records (collection, id, data, client_updated_at) values ${values}`)).rejects.toMatchObject({ code: '23514' })
    expect(await usage(B, 'notes')).toMatchObject({ live: 1 })
    expect(await stored(B)).toEqual(await recount(B))
  })

  it('itens apagados não contam no limite da coleção', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) await put(B, 'notes', id, {}, true)
    for (const id of ['f', 'g', 'h']) await put(B, 'notes', id)
    expect(await usage(B, 'notes')).toMatchObject({ live: 3, total: 8 })
  })

  it('o limite é de cada coleção: outra coleção continua livre', async () => {
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id)
    await put(B, 'tasks', 't1')
    expect(await usage(B, 'tasks')).toMatchObject({ live: 1 })
  })

  it('mudar um item de coleção pela API respeita o limite da coleção de destino', async () => {
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id)
    await put(B, 'tasks', 't1')
    await expect(as(B, `update records set collection = 'notes' where id = 't1'`)).rejects.toMatchObject({ code: '23514' })
    await put(B, 'notes', 'c', {}, true)
    await as(B, `update records set collection = 'notes' where id = 't1'`)
    expect(await stored(B)).toEqual(await recount(B))
  })

  it('escrita atrasada (descartada pelo servidor) não mexe na contagem', async () => {
    await put(B, 'notes', 'a', { v: 'nova' }, false, '2026-10-24T12:00:00Z')
    const u = await usage(B, '*')
    await put(B, 'notes', 'a', {}, true, '2026-10-24T09:00:00Z')
    expect(await usage(B, '*')).toEqual(u)
    expect((await as(B, `select deleted from records where id = 'a'`)).rows[0].deleted).toBe(false)
  })
})

describe('contas separadas', () => {
  it('uma conta no limite não afeta outra', async () => {
    await db.exec(`delete from records where user_id in ('${B}', '${C}')`)
    await setLimit('records.notes', 2)
    await put(B, 'notes', 'a')
    await put(B, 'notes', 'b')
    await expect(put(B, 'notes', 'c')).rejects.toMatchObject({ code: '23514' })
    await put(C, 'notes', 'a')
    await put(C, 'notes', 'b')
    expect(await usage(C, 'notes')).toMatchObject({ live: 2 })
    expect(await usage(B, 'notes')).toMatchObject({ live: 2 })
  })

  it('cada conta só lê o próprio uso; ninguém do app escreve no uso nem nos limites', async () => {
    expect((await as(B, 'select distinct user_id from quota_usage')).rows.map((r) => r.user_id)).toEqual([B])
    expect((await as(B, 'select * from quota_limits')).rows.length).toBeGreaterThan(30)
    await expect(as(B, `update quota_usage set live = 0`)).rejects.toThrow(/permission denied/)
    await expect(as(B, `insert into quota_usage (user_id, scope) values ($1, 'x')`, [B])).rejects.toThrow(/permission denied/)
    await expect(as(B, `delete from quota_usage`)).rejects.toThrow(/permission denied/)
    await expect(as(B, `update quota_limits set max_value = 999999999`)).rejects.toThrow(/permission denied/)
    await expect(as(B, `select records_quota()`)).rejects.toThrow()
    await expect(as(null, 'select * from quota_usage')).rejects.toThrow(/permission denied/)
  })
})

describe('limites da conta inteira', () => {
  beforeEach(async () => {
    await db.exec(`delete from records where user_id in ('${B}', '${C}')`)
    await setLimit('records.notes', 10000)
  })

  it('linhas da conta contam apagados: criar e apagar em loop não passa do limite', async () => {
    await setLimit('account.rows', 4)
    for (const id of ['a', 'b', 'c']) await put(B, 'notes', id, {}, true)
    await put(B, 'tasks', 't')
    await expect(put(B, 'notes', 'd', {}, true)).rejects.toMatchObject({ message: 'quota_exceeded:account.rows:4' })
    await put(B, 'notes', 'a', { title: 'reaproveita' }) // reativar não cria linha nova
    await setLimit('account.rows', 200000)
  })

  it('tamanho: recusa criar ou fazer crescer acima do limite; diminuir e apagar continuam livres', async () => {
    await setLimit('account.bytes', 1000)
    await put(B, 'notes', 'a', { text: 'x'.repeat(500) })
    await expect(put(B, 'notes', 'b', { text: 'x'.repeat(600) })).rejects.toMatchObject({ message: 'quota_exceeded:account.bytes:1000' })
    await expect(put(B, 'notes', 'a', { text: 'x'.repeat(1100) })).rejects.toMatchObject({ code: '23514' })
    await put(B, 'notes', 'a', { text: 'x'.repeat(100) })
    await put(B, 'notes', 'b', { text: 'x'.repeat(600) })
    expect(await stored(B)).toEqual(await recount(B))
    await setLimit('account.bytes', 26214400)
  })

  it('conta que já está acima de um limite mantém tudo, edita, apaga, e só não cria', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await put(B, 'notes', id, { title: id })
    await setLimit('records.notes', 2)
    const kept = (await as(B, `select id from records where collection = 'notes'`)).rows
    expect(kept).toHaveLength(4)
    await put(B, 'notes', 'a', { title: 'editada' })
    await expect(put(B, 'notes', 'e')).rejects.toMatchObject({ code: '23514' })
    await put(B, 'notes', 'a', {}, true)
    await put(B, 'notes', 'b', {}, true)
    await put(B, 'notes', 'c', {}, true)
    await put(B, 'notes', 'e')
    expect(await stored(B)).toEqual(await recount(B))
    await setLimit('records.notes', 10000)
  })

  it('limite padrão do app: uma imagem grande do portfólio (300 KB) passa normalmente', async () => {
    await put(B, 'portfolio', 'p1', { image: 'data:image/jpeg;base64,' + 'A'.repeat(300_000) })
    expect((await usage(B, 'portfolio')).bytes).toBeGreaterThan(300_000)
  })
})

describe('contagem sempre igual à realidade', () => {
  it('depois de uma sequência misturada de criar, editar, apagar e DELETE', async () => {
    await db.exec(`delete from records where user_id = '${C}'`)
    const cols = ['notes', 'tasks', 'transactions', 'meals']
    for (let i = 0; i < 120; i++) {
      const col = cols[i % cols.length]
      const id = `x${i % 37}`
      const r = (i * 7919) % 10
      if (r < 5) await put(C, col, id, { n: 'y'.repeat(i) })
      else if (r < 8) await put(C, col, id, {}, true)
      else await as(C, `delete from records where collection = $1 and id = $2`, [col, id])
    }
    expect(await stored(C)).toEqual(await recount(C))
  })

  it('excluir a conta (auth.users) apaga tudo em cascata sem erro', async () => {
    const D = '44444444-4444-4444-8444-444444444444'
    await db.query('insert into auth.users (id) values ($1)', [D])
    await put(D, 'notes', 'a')
    await db.query('delete from auth.users where id = $1', [D])
    expect((await db.query('select * from quota_usage where user_id = $1', [D])).rows).toHaveLength(0)
    expect((await db.query('select * from records where user_id = $1', [D])).rows).toHaveLength(0)
  })
})

describe('notificações push', () => {
  it('no máximo N aparelhos por conta; o mesmo aparelho de novo não conta; aparelho compartilhado ainda troca de dono', async () => {
    await setLimit('push.devices', 2)
    await as(B, `select claim_push_endpoint('https://push.example/1', 'p', 'a')`)
    await as(B, `select claim_push_endpoint('https://push.example/2', 'p', 'a')`)
    await as(B, `select claim_push_endpoint('https://push.example/2', 'p2', 'a2')`)
    await expect(as(B, `select claim_push_endpoint('https://push.example/3', 'p', 'a')`)).rejects.toMatchObject({ message: 'quota_exceeded:push.devices:2' })
    await expect(as(B, `insert into push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/4', 'p', 'a')`)).rejects.toMatchObject({ code: '23514' })
    await as(C, `select claim_push_endpoint('https://push.example/2', 'p', 'a')`)
    expect((await as(B, 'select endpoint from push_subscriptions')).rows).toEqual([{ endpoint: 'https://push.example/1' }])
    await as(B, `select claim_push_endpoint('https://push.example/3', 'p', 'a')`)
    await setLimit('push.devices', 10)
  })
})

describe('lembretes agendados', () => {
  const sched = (user: string, keys: string[], extra = '') =>
    as(user, `insert into scheduled_notifications (key, fire_at, title, body${extra ? ', sent_at' : ''})
              select k, now() + interval '1 day', 'Núcleo', 'Lembrete'${extra ? `, ${extra}` : ''} from unnest($1::text[]) k
              on conflict (user_id, key) do update set fire_at = excluded.fire_at, title = excluded.title`, [keys])

  it('limite de lembretes ativos; reagendar o mesmo lembrete não conta; outra conta livre', async () => {
    await setLimit('notifications.active', 3)
    await sched(B, ['a', 'b', 'c'])
    await sched(B, ['a', 'b', 'c'])
    await expect(sched(B, ['d'])).rejects.toMatchObject({ message: 'quota_exceeded:notifications.active:3' })
    await sched(C, ['a', 'b', 'c'])
    await as(B, `delete from scheduled_notifications where key = 'a'`)
    await sched(B, ['d'])
  })

  it('o app não consegue marcar como enviado (burlaria a contagem); o dispatcher consegue', async () => {
    await expect(sched(B, ['e'], `'2020-01-01'::timestamptz`)).rejects.toMatchObject({ code: '23514' })
    await as(B, `delete from scheduled_notifications where key = 'b'`)
    await sched(B, ['e'], `'2020-01-01'::timestamptz`)
    expect((await as(B, `select sent_at from scheduled_notifications where key = 'e'`)).rows[0].sent_at).toBeNull()
    await as(B, `update scheduled_notifications set sent_at = '2020-01-01' where key = 'e'`)
    expect((await as(B, `select sent_at from scheduled_notifications where key = 'e'`)).rows[0].sent_at).toBeNull()
    await db.query(`update scheduled_notifications set fire_at = now() - interval '1 minute' where user_id = $1 and key = 'e'`, [B])
    await db.exec('set role service_role')
    const sent = await db.query('select * from claim_due_notifications(50)')
    await db.exec('reset role')
    expect(sent.rows.map((r) => (r as { key: string }).key)).toContain('e')
    // Enviado há mais de 14 dias deixa de contar.
    await db.query(`update scheduled_notifications set sent_at = now() - interval '15 days' where user_id = $1 and key = 'e'`, [B])
    await sched(B, ['f'])
    await setLimit('notifications.active', 2000)
  })
})
