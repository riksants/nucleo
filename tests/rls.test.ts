/**
 * Runs the real migration on a real Postgres (PGlite, WASM) with a minimal
 * stand-in for Supabase's auth schema, then acts as two different users the
 * same way PostgREST does (role `authenticated` + JWT `sub` claim).
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
let db: PGlite

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
  }
}

const now = () => new Date().toISOString()

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  // All migrations, in order, exactly as they run on Supabase.
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`)
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [A, B])
  await as(A, `insert into records (collection, id, data, client_updated_at) values ('notes', 'n1', '{"title":"segredo de A"}', $1)`, [now()])
  await as(A, `insert into user_settings (data, client_updated_at) values ('{"baseCurrency":"EUR"}', $1)`, [now()])
  await as(A, `insert into scheduled_notifications (key, fire_at, title, body) values ('k1', now(), 'Núcleo', 'Lembrete')`)
})

describe('isolamento entre contas (RLS)', () => {
  it('B não lê registros, configurações nem lembretes de A', async () => {
    expect((await as(B, 'select * from records')).rows).toHaveLength(0)
    expect((await as(B, 'select * from user_settings')).rows).toHaveLength(0)
    expect((await as(B, 'select * from scheduled_notifications')).rows).toHaveLength(0)
    expect((await as(A, 'select * from records')).rows).toHaveLength(1)
  })

  it('B não consegue criar linhas em nome de A', async () => {
    await expect(
      as(B, `insert into records (user_id, collection, id, data, client_updated_at) values ($1, 'notes', 'x', '{}', $2)`, [A, now()]),
    ).rejects.toThrow(/row-level security/)
    await expect(as(B, `insert into user_settings (user_id, data) values ($1, '{}')`, [A])).rejects.toThrow(/row-level security/)
  })

  it('B não altera nem apaga linhas de A (0 linhas afetadas)', async () => {
    expect((await as(B, `update records set data = '{"title":"hack"}' where id = 'n1'`)).affectedRows).toBe(0)
    expect((await as(B, `delete from records where id = 'n1'`)).affectedRows).toBe(0)
    expect((await as(B, `update user_settings set data = '{}'`)).affectedRows).toBe(0)
    expect((await as(B, `delete from scheduled_notifications`)).affectedRows).toBe(0)
    const row = (await as(A, `select data from records where id = 'n1'`)).rows[0]
    expect(row.data).toEqual({ title: 'segredo de A' })
  })

  it('mesmo id em contas diferentes não colide nem sobrescreve', async () => {
    await as(B, `insert into records (collection, id, data, client_updated_at) values ('notes', 'n1', '{"title":"de B"}', $1)
                 on conflict (user_id, collection, id) do update set data = excluded.data`, [now()])
    expect((await as(A, `select data from records where id = 'n1'`)).rows[0].data).toEqual({ title: 'segredo de A' })
    expect((await as(B, `select data from records where id = 'n1'`)).rows[0].data).toEqual({ title: 'de B' })
  })

  it('B não consegue mover a própria linha para A', async () => {
    await expect(as(B, `update records set user_id = $1 where id = 'n1'`, [A])).rejects.toThrow()
  })

  it('sem login (anon) nada é acessível', async () => {
    await expect(as(null, 'select * from records')).rejects.toThrow(/permission denied/)
    await expect(as(null, 'select * from user_settings')).rejects.toThrow(/permission denied/)
    await expect(as(null, 'select * from ai_usage')).rejects.toThrow(/permission denied/)
  })

  it('usuário comum não escreve em ai_usage (limites ficam no servidor)', async () => {
    await expect(as(A, `insert into ai_usage (user_id, kind, request_id) values ($1, 'routine', 'abcdefgh')`, [A])).rejects.toThrow()
  })

  it('usuário comum não chama o dispatcher de notificações', async () => {
    await expect(as(A, 'select * from claim_due_notifications(10)')).rejects.toThrow(/permission denied/)
  })
})

describe('regras de escrita', () => {
  it('rejeita senha em texto aberto em "accounts"', async () => {
    await expect(
      as(A, `insert into records (collection, id, data, client_updated_at) values ('accounts', 'a1', '{"name":"x","password":"123"}', $1)`, [now()]),
    ).rejects.toThrow(/records_no_plain_password/)
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('accounts', 'a1', '{"name":"x","password":"","secret":{"v":1,"iv":"a","ct":"b"}}', $1)`, [now()])
  })

  it('escrita atrasada (aparelho offline) não sobrescreve versão mais nova', async () => {
    const newer = '2026-10-01T12:00:00Z'
    const older = '2026-10-01T09:00:00Z'
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('tasks', 't1', '{"title":"nova"}', $1)`, [newer])
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('tasks', 't1', '{"title":"velha"}', $1)
                 on conflict (user_id, collection, id) do update set data = excluded.data, client_updated_at = excluded.client_updated_at`, [older])
    expect((await as(A, `select data from records where id = 't1'`)).rows[0].data).toEqual({ title: 'nova' })
  })

  it('dispatcher reserva cada lembrete uma única vez', async () => {
    await db.exec('set role service_role')
    const first = await db.query('select * from claim_due_notifications(10)')
    const second = await db.query('select * from claim_due_notifications(10)')
    await db.exec('reset role')
    expect(first.rows).toHaveLength(1)
    expect(second.rows).toHaveLength(0)
  })

  it('aparelho compartilhado: inscrição de push passa para o último usuário', async () => {
    const ep = 'https://push.example/abc'
    await as(A, `select claim_push_endpoint($1, 'p', 'a')`, [ep])
    await as(B, `select claim_push_endpoint($1, 'p', 'a')`, [ep])
    expect((await as(A, 'select * from push_subscriptions')).rows).toHaveLength(0)
    expect((await as(B, 'select * from push_subscriptions')).rows).toHaveLength(1)
  })
})

describe('Etapas 1 e 2: coleções novas', () => {
  const NEW = ['inbox', 'habits', 'recurring', 'completions', 'events', 'focusSessions', 'weeklyGoals', 'challenges', 'weekCheckins', 'weekSnapshots', 'financeGoals', 'lifePlans', 'planSteps']

  it('a migração mantém registros antigos e aceita as coleções novas', async () => {
    expect((await as(A, `select count(*)::int as n from records where collection = 'notes'`)).rows[0].n).toBeGreaterThan(0)
    for (const c of NEW) await as(A, `insert into records (collection, id, data, client_updated_at) values ($1, 'x1', '{}', $2)`, [c, now()])
    await expect(as(A, `insert into records (collection, id, data, client_updated_at) values ('inventada', 'x', '{}', $1)`, [now()])).rejects.toThrow(/records_collection_check/)
  })

  it('B não lê, altera, apaga nem cria hábitos e conclusões de A', async () => {
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('completions', 'habit:h1:2026-10-01', '{"status":"done"}', $1)`, [now()])
    for (const c of NEW) expect((await as(B, 'select * from records where collection = $1', [c])).rows).toHaveLength(0)
    expect((await as(B, `update records set data = '{"status":"skipped"}' where id = 'habit:h1:2026-10-01'`)).affectedRows).toBe(0)
    expect((await as(B, `delete from records where collection = 'completions'`)).affectedRows).toBe(0)
    await expect(as(B, `insert into records (user_id, collection, id, data, client_updated_at) values ($1, 'habits', 'hB', '{}', $2)`, [A, now()])).rejects.toThrow(/row-level security/)
    expect((await as(A, `select data from records where id = 'habit:h1:2026-10-01'`)).rows[0].data).toEqual({ status: 'done' })
  })

  it('mesma conclusão (mesmo id fixo) em contas diferentes não colide', async () => {
    await as(B, `insert into records (collection, id, data, client_updated_at) values ('completions', 'habit:h1:2026-10-01', '{"status":"skipped"}', $1)`, [now()])
    expect((await as(A, `select data from records where id = 'habit:h1:2026-10-01'`)).rows[0].data).toEqual({ status: 'done' })
    expect((await as(B, `select data from records where id = 'habit:h1:2026-10-01'`)).rows[0].data).toEqual({ status: 'skipped' })
  })
})

describe('Etapa 3: finanças', () => {
  it('B não lê, altera nem apaga movimentações e metas financeiras de A', async () => {
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('financeGoals', 'fg1', '{"name":"Reserva","target":500000,"saved":200000}', $1)`, [now()])
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('transactions', 'tx-cat', '{"type":"out","amount":1000,"category":"food","unnecessary":true}', $1)`, [now()])
    for (const c of ['financeGoals', 'transactions']) expect((await as(B, 'select * from records where collection = $1', [c])).rows).toHaveLength(0)
    expect((await as(B, `update records set data = '{"saved":0}' where id = 'fg1'`)).affectedRows).toBe(0)
    expect((await as(B, `delete from records where collection in ('financeGoals', 'transactions')`)).affectedRows).toBe(0)
    await expect(as(B, `insert into records (user_id, collection, id, data, client_updated_at) values ($1, 'financeGoals', 'fgB', '{}', $2)`, [A, now()])).rejects.toThrow(/row-level security/)
    expect((await as(A, `select data from records where id = 'fg1'`)).rows[0].data.saved).toBe(200000)
    expect((await as(A, `select data from records where id = 'tx-cat'`)).rows[0].data).toMatchObject({ category: 'food', unnecessary: true })
  })

  it('mesmo id de meta em contas diferentes não colide', async () => {
    await as(B, `insert into records (collection, id, data, client_updated_at) values ('financeGoals', 'fg1', '{"saved":1}', $1)`, [now()])
    expect((await as(A, `select data from records where id = 'fg1'`)).rows[0].data.saved).toBe(200000)
    expect((await as(B, `select data from records where id = 'fg1'`)).rows[0].data.saved).toBe(1)
  })
})

describe('Etapa 4: planejamento pessoal', () => {
  it('B não lê, altera nem apaga projetos pessoais, objetivos e etapas de A', async () => {
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('lifePlans', 'p1', '{"kind":"objective","title":"Aprender inglês"}', $1)`, [now()])
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('planSteps', 's1', '{"planId":"p1","title":"Curso A","status":"todo"}', $1)`, [now()])
    for (const c of ['lifePlans', 'planSteps']) expect((await as(B, 'select * from records where collection = $1', [c])).rows).toHaveLength(0)
    expect((await as(B, `update records set data = '{"status":"done"}' where id in ('p1', 's1')`)).affectedRows).toBe(0)
    expect((await as(B, `delete from records where collection in ('lifePlans', 'planSteps')`)).affectedRows).toBe(0)
    await expect(as(B, `insert into records (user_id, collection, id, data, client_updated_at) values ($1, 'planSteps', 'sB', '{}', $2)`, [A, now()])).rejects.toThrow(/row-level security/)
    expect((await as(A, `select data from records where id = 's1'`)).rows[0].data.status).toBe('todo')
    expect((await as(A, `select data from records where id = 'p1'`)).rows[0].data.title).toBe('Aprender inglês')
  })
})

describe('Etapa 2: check-in e resumo por semana', () => {
  it('um check-in por semana (id = semana); B não lê nem sobrescreve o de A', async () => {
    await as(A, `insert into records (collection, id, data, client_updated_at) values ('weekCheckins', '2026-09-28', '{"note":"de A"}', $1)`, [now()])
    await as(B, `insert into records (collection, id, data, client_updated_at) values ('weekCheckins', '2026-09-28', '{"note":"de B"}', $1)`, [now()])
    expect((await as(A, `select data from records where collection = 'weekCheckins' and id = '2026-09-28'`)).rows.map((r) => r.data)).toEqual([{ note: 'de A' }])
    expect((await as(B, `update records set data = '{}' where collection = 'weekSnapshots'`)).affectedRows).toBe(0)
  })
})
