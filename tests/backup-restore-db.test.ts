/**
 * Backup/restore logic on a real Postgres (PGlite), in-process. Complements the CI self-test
 * (scripts/backup/selftest.sh on postgres:17, which exercises the full psql \copy + age pipeline):
 * here we prove, locally and on every `npm test`, that
 *   - scripts/backup/validate.sql passes on a correctly restored database, and
 *   - it actually FAILS when a table/constraint/RLS/trigger/counter is broken (no silent pass), and
 *   - the new ai_entitlements export column round-trips and is readable by the backup role, and
 *   - restore.sql's quota_usage reconstruction and orphan check hold.
 * The database here is built the way restore.sql builds one: stub + every migration, rows copied in
 * with triggers off, then quota_usage rebuilt from records.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let db: PGlite

const SUPABASE_STUB = readFileSync('scripts/backup/supabase-stub.sql', 'utf8')
// validate.sql, minus the psql-only meta line (\set ...), so db.exec can run it.
const VALIDATE = readFileSync('scripts/backup/validate.sql', 'utf8')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('\\'))
  .join('\n')

const validate = () => db.exec(VALIDATE)
const throwsFrom = async (p: Promise<unknown>) => {
  try {
    await p
    return null
  } catch (e) {
    return (e as Error).message
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  // Rows copied in the way restore.sql does it: triggers and FK checks off, exact values.
  await db.exec(`
    begin;
    set local session_replication_role = replica;
    insert into auth.users (id, email, created_at) values
      ('${A}', 'alice@selftest.invalid', '2026-01-02T03:04:05Z'),
      ('${B}', 'bob@selftest.invalid', '2026-02-03T04:05:06Z');
    insert into public.records (user_id, collection, id, data, deleted, client_updated_at, server_updated_at) values
      ('${A}', 'notes', 'n1', '{"id":"n1","title":"primeira"}', false, '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z'),
      ('${A}', 'notes', 'n2', '{"id":"n2","title":"apagada"}', true, '2026-03-02T10:00:00Z', '2026-03-02T10:00:00Z'),
      ('${A}', 'transactions', 't1', '{"id":"t1","type":"in","currency":"BRL","amount":12345,"baseAmount":12345}', false, '2026-03-03T10:00:00Z', '2026-03-03T10:00:00Z'),
      ('${A}', 'accounts', 'ac1', '{"id":"ac1","secret":{"v":1,"iv":"YWFh","ct":"YmJi"}}', false, '2026-03-04T10:00:00Z', '2026-03-04T10:00:00Z'),
      ('${B}', 'tasks', 'k1', '{"id":"k1","text":"tarefa"}', false, '2026-03-05T10:00:00Z', '2026-03-05T10:00:00Z');
    insert into public.user_settings (user_id, data, client_updated_at, server_updated_at) values
      ('${A}', '{"baseCurrency":"BRL"}', '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z');
    insert into public.ai_entitlements (user_id, tier, valid_until, started_at, updated_at) values
      ('${A}', 'owner', null, '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z'),
      ('${B}', 'free', null, '2026-03-05T10:00:00Z', '2026-03-05T10:00:00Z');
    insert into public.quota_usage (user_id, scope, live, total, bytes)
      select user_id, collection, count(*) filter (where not deleted), count(*), sum(octet_length(data::text))
        from public.records group by user_id, collection
      union all
      select user_id, '*', count(*) filter (where not deleted), count(*), sum(octet_length(data::text))
        from public.records group by user_id;
    commit;
  `)
  await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`)
}, 60_000)

describe('validate.sql numa restauração correta', () => {
  it('passa: estrutura completa, invariantes e um registro real legível', async () => {
    expect(await throwsFrom(validate())).toBeNull()
  })
})

describe('validate.sql pega problemas (não passa em silêncio)', () => {
  it('falha quando falta uma constraint de proteção', async () => {
    await db.exec(`alter table public.records drop constraint records_no_plain_password`)
    expect(await throwsFrom(validate())).toMatch(/constraint ausente.*records_no_plain_password/s)
    await db.exec(`alter table public.records add constraint records_no_plain_password
      check (collection <> 'accounts' or coalesce(data ->> 'password', '') = '')`)
    expect(await throwsFrom(validate())).toBeNull()
  })

  it('falha quando a RLS de uma tabela de contas está desligada', async () => {
    await db.exec(`alter table public.records disable row level security`)
    expect(await throwsFrom(validate())).toMatch(/RLS desligada em public\.records/)
    await db.exec(`alter table public.records enable row level security`)
    expect(await throwsFrom(validate())).toBeNull()
  })

  it('falha quando um contador de uso diverge dos records', async () => {
    await db.exec(`update public.quota_usage set total = total + 5 where user_id = '${A}' and scope = '*'`)
    expect(await throwsFrom(validate())).toMatch(/contadores de uso/)
    await db.exec(`update public.quota_usage set total = total - 5 where user_id = '${A}' and scope = '*'`)
    expect(await throwsFrom(validate())).toBeNull()
  })

  it('falha quando há um registro órfão (conta ausente do backup)', async () => {
    await db.exec(`begin; set local session_replication_role = replica;
      insert into public.records (user_id, collection, id, data, client_updated_at, server_updated_at)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'notes', 'x', '{"id":"x"}', now(), now());
      insert into public.quota_usage (user_id, scope, live, total, bytes)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '*', 1, 1, 10); commit;`)
    expect(await throwsFrom(validate())).toMatch(/órfãos/)
    await db.exec(`begin; set local session_replication_role = replica;
      delete from public.records where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      delete from public.quota_usage where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; commit;`)
    expect(await throwsFrom(validate())).toBeNull()
  })
})

describe('ai_entitlements entra no backup', () => {
  it('o papel de backup lê as cinco colunas exportadas', async () => {
    await db.exec(`set role nucleo_backup`)
    try {
      const r = await db.query<{ user_id: string; tier: string }>(
        'select user_id, tier, valid_until, started_at, updated_at from public.ai_entitlements order by user_id',
      )
      expect(r.rows.map((x) => x.tier)).toEqual(['owner', 'free'])
    } finally {
      await db.exec('reset role')
    }
  })

  it('todo entitlement aponta para um nível existente', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from public.ai_entitlements e where not exists (select 1 from public.ai_tiers t where t.tier = e.tier)`,
    )
    expect(r.rows[0].n).toBe(0)
  })
})
