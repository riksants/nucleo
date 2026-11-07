/**
 * PARTE 2 (contas): "Excluir conta" with EVERY migration applied, on a real Postgres (PGlite). The Etapa 9 test
 * (auditoria-db) only sees the tables that existed then; this one finds every public table with a user_id column,
 * so a table added later that wouldn't go away with the account fails here.
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
  create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
`
const recent = () => ({ amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] })

async function as(user: string | null, sql: string, params: unknown[] = [], claims: object = {}) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [user ?? '', JSON.stringify({ sub: user, ...claims })])
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  try {
    return await db.query<Record<string, unknown>>(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)
  }
}
const fails = async (p: Promise<unknown>) => {
  try {
    await p
    return null
  } catch (e) {
    return (e as Error).message
  }
}
const count = async (table: string, user: string) => (await db.query<{ n: number }>(`select count(*)::int n from public.${table} where user_id = $1`, [user])).rows[0].n

/** Every public table that belongs to someone (has a user_id column). */
async function userTables(): Promise<string[]> {
  const r = await db.query<{ t: string }>(`select table_name t from information_schema.columns where table_schema = 'public' and column_name = 'user_id' order by 1`)
  return r.rows.map((x) => x.t)
}

/** Fills each table the way the app and the server do (records through the app's role; the rest as the server). */
async function fill(user: string) {
  await as(user, `insert into records (collection, id, data, client_updated_at) values ('tasks', 't1', '{"title":"a"}', now())`)
  // A second version: the first one goes to records_history.
  await as(user, `update records set data = '{"title":"b"}', client_updated_at = now() + interval '1 second' where id = 't1'`)
  await as(user, `insert into user_settings (data, client_updated_at) values ('{}', now())`)
  await db.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [user, `https://push.example/${user}`])
  await db.query(`insert into scheduled_notifications (user_id, key, fire_at, title, body) values ($1, 'k1', now() + interval '1 hour', 't', 'b')`, [user])
  await db.query(`insert into ai_usage (user_id, kind, request_id) values ($1, 'routine', 'abcdefgh')`, [user])
  await db.query(`insert into quota_usage (user_id, scope) values ($1, 'teste')`, [user])
  await db.query(`insert into notification_state (user_id, tz) values ($1, 'Europe/Madrid')`, [user])
  await db.query(
    `insert into notification_series (user_id, key, template, rule, day_offset, at_time, minus_min, kind, title, body)
     values ($1, 's1', 'k:{d}', '{"type":"daily"}', 0, '09:00', 0, 'task', 't', 'b')`,
    [user],
  )
  await db.query(`insert into ai_entitlements (user_id, tier) values ($1, 'free')`, [user])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.query(`insert into auth.users (id, email) values ($1, 'a@x.com'), ($2, 'b@x.com')`, [A, B])
  await fill(A)
  await fill(B)
}, 180_000)

describe('excluir conta com todas as migrações (PARTE 2)', () => {
  it('o teste conhece todas as tabelas com dono: cada uma tem dados da conta antes da exclusão', async () => {
    const tables = await userTables()
    expect(tables.length).toBeGreaterThan(8)
    for (const t of tables) expect(await count(t, B), `${t}: sem dados de teste — inclua em fill()`).toBeGreaterThan(0)
  })

  it('uma conta não consegue excluir outra (nem pela função, nem direto em auth.users)', async () => {
    expect(await fails(as(A, `delete from auth.users where id = '${B}'`, [], recent()))).toMatch(/permission denied/)
    expect(await fails(as(A, `select delete_my_account('${B}')`, [], recent()))).toMatch(/does not exist|function/)
    expect(await fails(as(null, 'select delete_my_account()', [], recent()))).toMatch(/permission denied|não autenticado/)
    expect((await db.query('select 1 from auth.users where id = $1', [B])).rows).toHaveLength(1)
  })

  it('apaga a própria conta e tudo dela em todas as tabelas; a outra conta fica intacta', async () => {
    const tables = await userTables()
    const before: Record<string, number> = {}
    for (const t of tables) before[t] = await count(t, A)
    await as(B, 'select delete_my_account()', [], recent())
    expect((await db.query('select 1 from auth.users where id = $1', [B])).rows).toHaveLength(0)
    for (const t of tables) {
      expect(await count(t, B), t).toBe(0)
      expect(await count(t, A), `${t} (outra conta)`).toBe(before[t])
    }
  })

  it('o token que sobrou da conta excluída não lê nem grava nada', async () => {
    expect((await as(B, 'select * from records')).rows).toHaveLength(0)
    expect((await as(B, 'select * from user_settings')).rows).toHaveLength(0)
    expect(await fails(as(B, `insert into records (collection, id, data, client_updated_at) values ('tasks', 'volta', '{}', now())`))).toMatch(/foreign key|violates/)
  })
})
