/**
 * Migration 20261027000000_auditoria_etapas_4_10.sql on a real Postgres (PGlite), acting as users the
 * same way PostgREST does: dates from the device clock (A3/B4), version history (Etapa 4), the backup
 * role, schema_version, the AI reservation (A10), account deletion (Etapa 9) and the Etapa 10 hardening.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const FILE = '20261027000000_auditoria_etapas_4_10.sql'
let db: PGlite
let beforeHash: string

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

async function as(user: string | null, sql: string, params: unknown[] = [], opts: { role?: string; claims?: object } = {}) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [
    user ?? '',
    JSON.stringify({ sub: user, ...opts.claims }),
  ])
  await db.exec(`set role ${opts.role ?? (user ? 'authenticated' : 'anon')}`)
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

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString()
const put = (user: string, collection: string, id: string, data: object = {}, deleted = false, at = iso()) =>
  as(user, `insert into records (collection, id, data, deleted, client_updated_at) values ($1, $2, $3, $4, $5)
            on conflict (user_id, collection, id) do update set data = excluded.data, deleted = excluded.deleted, client_updated_at = excluded.client_updated_at`,
  [collection, id, JSON.stringify(data), deleted, at])
const row = async (user: string, collection: string, id: string) =>
  (await db.query<{ data: Record<string, unknown>; deleted: boolean; client_updated_at: Date }>('select data, deleted, client_updated_at from records where user_id = $1 and collection = $2 and id = $3', [user, collection, id])).rows[0]
const versions = async (user: string, id: string) =>
  (await db.query<{ version_id: number; data: Record<string, unknown>; deleted: boolean }>('select version_id, data, deleted from records_history where user_id = $1 and id = $2 order by version_id', [user, id])).rows
const historyUsage = async (user: string) => {
  const real = (await db.query<{ n: number; b: number }>('select count(*)::int n, coalesce(sum(bytes), 0)::int b from records_history where user_id = $1', [user])).rows[0]
  const kept = (await db.query<{ n: number; b: number }>('select versions::int n, bytes::int b from records_history_usage where user_id = $1', [user])).rows[0] ?? { n: 0, b: 0 }
  return { real, kept }
}
/** Pretends the versions of an item were saved `minutes` ago (the throttle and the age limit look at this). */
const age = (user: string, minutes: number) =>
  db.query(`update records_history set replaced_at = now() - make_interval(mins => $2) where user_id = $1`, [user, minutes])
const snapshot = async () =>
  (await db.query<{ h: string }>(`select md5(string_agg(t::text, '|' order by t::text)) as h from (
     select user_id, collection, id, data, deleted, client_updated_at from records) t`)).rows[0].h

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  const files = readdirSync('supabase/migrations').sort()
  for (const file of files.filter((f) => f < FILE)) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.query(`insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test'), ($3, 'c@example.test')`, [A, B, C])
  // Existing data, including a record frozen by a device clock in 2030 (the bug A3 fixes).
  await put(A, 'notes', 'old', { id: 'old', title: 'antes' })
  await put(A, 'notes', 'frozen', { id: 'frozen', title: 'congelada' }, false, '2030-01-01T00:00:00.000Z')
  await as(A, `insert into user_settings (data, client_updated_at) values ('{"baseCurrency":"EUR"}', '2030-01-01T00:00:00Z')`)
  beforeHash = await snapshot()
  await db.exec(readFileSync(`supabase/migrations/${FILE}`, 'utf8'))
  await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`)
}, 60_000)

describe('migração', () => {
  it('não altera nenhum registro que já existia', async () => {
    expect(await snapshot()).toBe(beforeHash)
  })

  it('registra as migrations já aplicadas e a própria em schema_version', async () => {
    const got = (await db.query<{ version: string }>('select version from schema_version order by version')).rows.map((r) => r.version)
    const expected = readdirSync('supabase/migrations').sort().filter((f) => f <= FILE).map((f) => f.replace(/\.sql$/, ''))
    expect(got).toEqual(expected)
  })

  it('pode rodar de novo sem erro e sem mudar nada', async () => {
    const h = await snapshot()
    await db.exec(readFileSync(`supabase/migrations/${FILE}`, 'utf8'))
    expect(await snapshot()).toBe(h)
  })
})

describe('datas do aparelho (A3, B4)', () => {
  it('data no futuro vale no máximo agora + 5 min', async () => {
    await put(B, 'notes', 'fut', { id: 'fut' }, false, '2099-01-01T00:00:00.000Z')
    const r = await row(B, 'notes', 'fut')
    expect(r.client_updated_at.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000)
  })

  it('o registro congelado antes da migração volta a aceitar edição e exclusão', async () => {
    await put(A, 'notes', 'frozen', { id: 'frozen', title: 'editada' })
    expect((await row(A, 'notes', 'frozen')).data.title).toBe('editada')
    await put(A, 'notes', 'frozen', {}, true)
    expect((await row(A, 'notes', 'frozen')).deleted).toBe(true)
  })

  it('escrita atrasada (relógio para trás) continua descartada', async () => {
    await put(B, 'notes', 'late', { id: 'late', v: 2 })
    await put(B, 'notes', 'late', { id: 'late', v: 1 }, false, iso(-60_000))
    expect((await row(B, 'notes', 'late')).data.v).toBe(2)
  })

  it('configurações congeladas no futuro também voltam a aceitar edição', async () => {
    await as(A, `update user_settings set data = '{"baseCurrency":"BRL"}', client_updated_at = now()`)
    expect((await db.query<{ data: { baseCurrency: string } }>('select data from user_settings where user_id = $1', [A])).rows[0].data.baseCurrency).toBe('BRL')
  })

  it('collection e id de uma linha não podem ser trocados', async () => {
    await put(B, 'notes', 'fixed', { id: 'fixed' })
    expect(await fails(as(B, `update records set collection = 'tasks' where id = 'fixed'`))).toMatch(/não podem mudar/)
    expect(await fails(as(B, `update records set id = 'outro' where id = 'fixed'`))).toMatch(/não podem mudar/)
  })

  it('lembretes só entre ontem e daqui a 90 dias (o app agenda até 14)', async () => {
    const ins = (at: string) => as(B, `insert into scheduled_notifications (key, fire_at, title, body) values ($1, $2, 'Núcleo', 'x')`, [`k-${at}`, at])
    expect(await fails(ins(iso(14 * 86400_000)))).toBeNull()
    expect(await fails(ins(iso(400 * 86400_000)))).toMatch(/fora da janela/)
    expect(await fails(ins(iso(-3 * 86400_000)))).toMatch(/fora da janela/)
  })
})

describe('histórico de versões (Etapa 4)', () => {
  it('editar guarda a versão anterior; regravar igual não guarda', async () => {
    await put(C, 'notes', 'h1', { id: 'h1', title: 'v1' })
    expect(await versions(C, 'h1')).toHaveLength(0)
    await put(C, 'notes', 'h1', { id: 'h1', title: 'v2' })
    await put(C, 'notes', 'h1', { id: 'h1', title: 'v2' })
    const v = await versions(C, 'h1')
    expect(v.map((x) => x.data.title)).toEqual(['v1'])
  })

  it('edições seguidas guardam no máximo uma versão a cada 10 min; exclusão sempre guarda', async () => {
    await put(C, 'notes', 'h1', { id: 'h1', title: 'v3' })
    expect(await versions(C, 'h1')).toHaveLength(1)
    await age(C, 11)
    await put(C, 'notes', 'h1', { id: 'h1', title: 'v4' })
    expect((await versions(C, 'h1')).map((x) => x.data.title)).toEqual(['v1', 'v3'])
    await put(C, 'notes', 'h1', {}, true)
    expect((await versions(C, 'h1')).map((x) => x.data.title)).toEqual(['v1', 'v3', 'v4'])
    // The tombstone itself is not a version worth keeping (undeleting does not add one).
    await put(C, 'notes', 'h1', { id: 'h1', title: 'v5' })
    expect(await versions(C, 'h1')).toHaveLength(3)
  })

  it('apagar de verdade (DELETE) guarda a última versão', async () => {
    await put(A, 'notes', 'h2', { id: 'h2', title: 'só uma' })
    await as(A, `delete from records where id = 'h2'`)
    expect((await versions(A, 'h2')).map((x) => x.data.title)).toEqual(['só uma'])
  })

  it('no máximo 20 versões por item (saem as mais antigas)', async () => {
    for (let i = 0; i < 25; i++) {
      await put(C, 'notes', 'h3', { id: 'h3', n: i })
      await put(C, 'notes', 'h3', {}, true)
    }
    const v = await versions(C, 'h3')
    expect(v).toHaveLength(20)
    expect(v.at(-1)!.data.n).toBe(24)
    const u = await historyUsage(C)
    expect(u.kept).toEqual(u.real)
  })

  it('passando do tamanho da conta, saem as mais antigas e a escrita continua', async () => {
    await db.query(`update quota_limits set max_value = 3000 where key = 'history.bytes'`)
    try {
      for (let i = 0; i < 6; i++) {
        await put(B, 'notes', `big-${i}`, { id: `big-${i}`, text: 'x'.repeat(900) })
        await put(B, 'notes', `big-${i}`, {}, true)
      }
      const u = await historyUsage(B)
      expect(u.kept).toEqual(u.real)
      expect(u.real.b).toBeLessThanOrEqual(3000)
      expect(u.real.n).toBeGreaterThan(0)
      // The newest is kept.
      expect(await versions(B, 'big-5')).toHaveLength(1)
      expect(await versions(B, 'big-0')).toHaveLength(0)
    } finally {
      await db.query(`update quota_limits set max_value = 26214400 where key = 'history.bytes'`)
    }
  })

  it('versões mais velhas que 30 dias saem (na escrita seguinte e na limpeza diária)', async () => {
    await put(C, 'notes', 'h4', { id: 'h4', n: 1 })
    await put(C, 'notes', 'h4', { id: 'h4', n: 2 })
    await age(C, 31 * 24 * 60)
    const removed = (await db.query<{ n: number }>('select records_history_cleanup()::int n')).rows[0].n
    expect(removed).toBeGreaterThan(0)
    expect((await db.query<{ n: number }>('select count(*)::int n from records_history where user_id = $1', [C])).rows[0].n).toBe(0)
    const u = await historyUsage(C)
    expect(u.kept).toEqual(u.real)
  })

  it('ninguém lê ou altera o histórico pelo app', async () => {
    await put(A, 'notes', 'old', { id: 'old', title: 'depois' })
    expect(await fails(as(A, 'select * from records_history'))).toMatch(/permission denied/)
    expect(await fails(as(A, 'select * from records_history_usage'))).toMatch(/permission denied/)
    expect(await fails(as(A, `delete from records_history`))).toMatch(/permission denied/)
    expect(await fails(as(A, 'select records_history_restore(1)'))).toMatch(/permission denied/)
    expect(await fails(as(A, 'select records_history_cleanup()'))).toMatch(/permission denied/)
  })

  it('o dono do projeto restaura uma versão: volta como a edição mais nova', async () => {
    const [v] = await versions(A, 'old')
    expect(v.data.title).toBe('antes')
    await db.query('select records_history_restore($1)', [v.version_id])
    const r = await row(A, 'notes', 'old')
    expect(r.data.title).toBe('antes')
    expect(r.deleted).toBe(false)
    // The version it replaced went to the history.
    expect((await versions(A, 'old')).map((x) => x.data.title)).toContain('depois')
  })

  it('restaura também um item apagado de vez', async () => {
    const [v] = await versions(A, 'h2')
    await db.query('select records_history_restore($1)', [v.version_id])
    expect((await row(A, 'notes', 'h2')).data.title).toBe('só uma')
  })
})

describe('usuário de backup', () => {
  it('lê registros e configurações de todas as contas', async () => {
    const r = await as(null, 'select count(distinct user_id)::int n from records', [], { role: 'nucleo_backup' })
    expect(r.rows[0].n).toBe(3)
    const s = await as(null, 'select count(*)::int n from user_settings', [], { role: 'nucleo_backup' })
    expect(s.rows[0].n).toBe(1)
    const accounts = await as(null, 'select * from backup_accounts()', [], { role: 'nucleo_backup' })
    expect(accounts.rows).toHaveLength(3)
  })

  it('não escreve nada e não lê o que não precisa', async () => {
    const asBackup = (sql: string) => fails(as(null, sql, [], { role: 'nucleo_backup' }))
    expect(await asBackup(`update records set data = '{}'`)).toMatch(/permission denied/)
    expect(await asBackup(`delete from records`)).toMatch(/permission denied/)
    expect(await asBackup(`insert into user_settings (user_id, data) values ('${B}', '{}')`)).toMatch(/permission denied/)
    expect(await asBackup('select * from push_subscriptions')).toMatch(/permission denied/)
    expect(await asBackup('select * from scheduled_notifications')).toMatch(/permission denied/)
    expect(await asBackup('select * from records_history')).toMatch(/permission denied/)
    expect(await asBackup('select * from ai_usage')).toMatch(/permission denied/)
  })

  it('a lista de contas não é acessível pelo app', async () => {
    expect(await fails(as(A, 'select * from backup_accounts()'))).toMatch(/permission denied/)
    expect(await fails(as(null, 'select * from backup_accounts()'))).toMatch(/permission denied/)
  })
})

describe('reserva de IA (A10)', () => {
  const reserve = (user: string, kind: string, req: string, limit = 3, busy = 180) =>
    db.query<{ outcome: string; usage_id: number | null }>('select * from ai_reserve($1, $2, $3, $4, $5)', [user, kind, req, limit, busy]).then((r) => r.rows[0])
  const finish = (id: number, status: string) => db.query('update ai_usage set status = $2 where id = $1', [id, status])

  it('reserva, repete o resultado e recusa enquanto está em andamento', async () => {
    const first = await reserve(A, 'routine', 'req-00001')
    expect(first.outcome).toBe('ok')
    expect((await reserve(A, 'routine', 'req-00001')).outcome).toBe('busy')
    expect((await reserve(A, 'meals', 'req-00002')).outcome).toBe('busy')
    // The Assistant has its own count: not blocked by a planner generation.
    expect((await reserve(A, 'assistant', 'req-00003')).outcome).toBe('ok')
    await finish(first.usage_id!, 'ok')
    expect((await reserve(A, 'routine', 'req-00001')).outcome).toBe('replay')
  })

  it('erros contam no limite do dia', async () => {
    const r = await reserve(B, 'routine', 'req-b-0001')
    await finish(r.usage_id!, 'error')
    const r2 = await reserve(B, 'routine', 'req-b-0002')
    await finish(r2.usage_id!, 'error')
    const r3 = await reserve(B, 'routine', 'req-b-0003')
    await finish(r3.usage_id!, 'ok')
    expect((await reserve(B, 'routine', 'req-b-0004')).outcome).toBe('limit')
    expect((await reserve(B, 'routine', 'req-b-0001')).outcome).toBe('duplicate')
  })

  it('uma geração que nunca terminou vira erro e libera a próxima', async () => {
    const r = await reserve(C, 'routine', 'req-c-0001', 10)
    await db.query(`update ai_usage set created_at = now() - interval '6 minutes' where id = $1`, [r.usage_id])
    expect((await reserve(C, 'routine', 'req-c-0002', 10)).outcome).toBe('ok')
    expect((await db.query<{ status: string }>('select status from ai_usage where id = $1', [r.usage_id])).rows[0].status).toBe('error')
  })

  it('teto global somando todas as contas', async () => {
    await db.query(`update quota_limits set max_value = (select count(*) from ai_usage) where key = 'ai.global_daily'`)
    try {
      expect((await reserve(C, 'assistant', 'req-c-0100', 100)).outcome).toBe('global-limit')
    } finally {
      await db.query(`update quota_limits set max_value = 200 where key = 'ai.global_daily'`)
    }
  })

  it('o app não chama a reserva', async () => {
    expect(await fails(as(A, `select * from ai_reserve('${A}', 'routine', 'req-x-0001', 100, 1)`))).toMatch(/permission denied/)
  })
})

describe('endurecimento (Etapa 10)', () => {
  it('B3: outra conta só perde o aparelho quando as chaves batem', async () => {
    await as(A, `select claim_push_endpoint('https://push.example/dev1', 'keyA', 'authA')`)
    await as(B, `select claim_push_endpoint('https://push.example/dev1', 'outra', 'authB')`)
    expect((await db.query('select 1 from push_subscriptions where user_id = $1', [A])).rows).toHaveLength(1)
    await as(B, `select claim_push_endpoint('https://push.example/dev1', 'keyA', 'authB')`)
    expect((await db.query('select 1 from push_subscriptions where user_id = $1', [A])).rows).toHaveLength(0)
  })

  it('I1: o app não altera inscrições de push nem escreve em ai_usage', async () => {
    expect(await fails(as(B, `update push_subscriptions set auth = 'x'`))).toMatch(/permission denied/)
    expect(await fails(as(B, `insert into ai_usage (user_id, kind, request_id) values ('${B}', 'routine', 'abcdefgh')`))).toMatch(/permission denied/)
    expect(await fails(as(B, `truncate records`))).toMatch(/permission denied/)
  })

  it('B5: senha de "Contas" só no formato do cofre', async () => {
    expect(await fails(put(B, 'accounts', 'ac1', { id: 'ac1', secret: { v: 1, iv: 'aaa', ct: 'bbb' } }))).toBeNull()
    expect(await fails(put(B, 'accounts', 'ac2', { id: 'ac2', secret: null }))).toBeNull()
    expect(await fails(put(B, 'accounts', 'ac3', { id: 'ac3', secret: 'texto puro' }))).toMatch(/records_accounts_secret_shape/)
    expect(await fails(put(B, 'accounts', 'ac4', { id: 'ac4', secret: { iv: 'aaa' } }))).toMatch(/records_accounts_secret_shape/)
  })
})

describe('excluir conta (Etapa 9)', () => {
  const recent = { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] }
  const old = { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 3600 }] }

  it('exige login com senha nos últimos 10 minutos', async () => {
    expect(await fails(as(B, 'select delete_my_account()', [], { claims: old }))).toMatch(/reauth_required/)
    expect(await fails(as(B, 'select delete_my_account()', [], { claims: {} }))).toMatch(/reauth_required/)
    expect(await fails(as(null, 'select delete_my_account()', [], { claims: recent }))).toMatch(/permission denied|não autenticado/)
  })

  it('apaga a conta e tudo dela (inclusive histórico e uso), sem tocar nas outras', async () => {
    const others = (await db.query<{ n: number }>('select count(*)::int n from records where user_id <> $1', [B])).rows[0].n
    expect((await db.query<{ n: number }>('select count(*)::int n from records_history where user_id = $1', [B])).rows[0].n).toBeGreaterThan(0)
    await as(B, 'select delete_my_account()', [], { claims: recent })
    for (const table of ['records', 'user_settings', 'records_history', 'records_history_usage', 'quota_usage', 'push_subscriptions', 'scheduled_notifications', 'ai_usage']) {
      const n = (await db.query<{ n: number }>(`select count(*)::int n from ${table} where user_id = $1`, [B])).rows[0].n
      expect(n, table).toBe(0)
    }
    expect((await db.query('select 1 from auth.users where id = $1', [B])).rows).toHaveLength(0)
    expect((await db.query<{ n: number }>('select count(*)::int n from records where user_id <> $1', [B])).rows[0].n).toBe(others)
  })
})
