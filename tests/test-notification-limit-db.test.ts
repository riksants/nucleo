/**
 * PARTE 9: send_test_notification() (migration 20261107010000) on a real Postgres (PGlite): 5 per hour per account,
 * counted and inserted under one per-account lock, answering HTTP 429 + Retry-After through PostgREST.
 * Real concurrency (20 sessions crossing a second boundary: 6 before the fix, 5 after) was checked on PostgreSQL 17;
 * PGlite has one connection, so here the rules and the response shape are checked.
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
async function send(user: string | null): Promise<{ ok: string | null; error: (Error & { code?: string; detail?: string }) | null }> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  try {
    return { ok: (await db.query<{ k: string }>('select send_test_notification() k')).rows[0].k, error: null }
  } catch (e) {
    return { ok: null, error: e as Error & { code?: string; detail?: string } }
  } finally {
    await db.exec('reset role')
  }
}
const oldTests = (user: string, n: number, minutesAgo = (i: number) => i * 5) =>
  db.query(`insert into scheduled_notifications (user_id, key, fire_at, title, body, origin, created_at) select $1, 'test:old' || g, now(), 't', 'b', 'test', now() - make_interval(mins => ($3::int[])[g]) from generate_series(1, $2) g`, [user, n, Array.from({ length: n }, (_, i) => minutesAgo(i + 1))])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [A, B])
}, 180_000)

describe('notificação de teste: 5 por hora, atômico, 429 (PARTE 9)', () => {
  it('o 5º passa; o 6º é recusado com 429, Retry-After e o mesmo texto que o app reconhece', async () => {
    await oldTests(A, 4)
    expect((await send(A)).ok).toMatch(/^test:/)
    const over = await send(A)
    expect(over.ok).toBeNull()
    expect(over.error?.code).toBe('PGRST')
    const body = JSON.parse(over.error!.message)
    expect(body).toMatchObject({ code: '23514', message: 'quota_exceeded:notifications.test:5' })
    const detail = JSON.parse(over.error!.detail!)
    expect(detail.status).toBe(429)
    // the old ones were 5, 10, 15 and 20 minutes ago: the oldest leaves the 1-hour window in ~40 minutes
    expect(Number(detail.headers['Retry-After'])).toBeGreaterThan(39 * 60)
    expect(Number(detail.headers['Retry-After'])).toBeLessThanOrEqual(40 * 60)
  })

  it('renova: testes com mais de 1 hora não contam', async () => {
    await oldTests(B, 5, () => 61)
    expect((await send(B)).ok).toMatch(/^test:/)
  })

  it('outra conta tem contador independente; sem login é recusado; permissões iguais', async () => {
    const C = '33333333-3333-4333-8333-333333333333'
    await db.query(`insert into auth.users (id) values ($1)`, [C])
    expect((await send(C)).ok).toMatch(/^test:/)
    expect((await send(null)).error?.message).toMatch(/permission denied|sem sessão/)
    const grants = (await db.query<{ a: boolean; u: boolean; p: boolean }>(`select has_function_privilege('anon', 'send_test_notification()', 'execute') a, has_function_privilege('authenticated', 'send_test_notification()', 'execute') u, has_function_privilege('public', 'send_test_notification()', 'execute') p`)).rows[0]
    expect(grants).toEqual({ a: false, u: true, p: false })
  })

  it('a função faz a contagem sob trava por conta (não "conta e depois insere" solto)', async () => {
    const def = (await db.query<{ d: string }>(`select pg_get_functiondef('public.send_test_notification()'::regprocedure) d`)).rows[0].d
    expect(def.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(-1)
    expect(def.indexOf('pg_advisory_xact_lock')).toBeLessThan(def.indexOf('count(*)'))
  })
})
