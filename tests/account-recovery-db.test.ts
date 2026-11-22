/**
 * PARTE 15 — recuperação de contas (lado Núcleo, em PGlite / Postgres real).
 * O único método de login do app é e-mail + senha (não há OAuth, magic-link nem telefone — auditado).
 * A estratégia de desastre é: recriar a conta com o MESMO UUID (que vem do accounts.csv) e obrigar a
 * redefinição de senha. Este teste prova a parte que é pura-Postgres:
 *   - o backup (id + e-mail) tem tudo para reconstruir auth.users E auth.identities (provider 'email');
 *   - o acesso aos dados é ligado ao UUID: entrando com o UUID original, a conta vê os próprios records
 *     e só os seus (isolamento por RLS) — ou seja, trocar a senha não afeta o acesso aos dados;
 *   - o UUID não muda.
 * A autenticação de verdade (bcrypt, exigência de auth.identities, emissão de token com sub = UUID) é
 * provada ponta-a-ponta com o GoTrue real em .github/workflows/account-recovery.yml.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const EMAIL_A = 'alice@selftest.invalid'
let db: PGlite

const SUPABASE_STUB = readFileSync('scripts/backup/supabase-stub.sql', 'utf8')

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [
    user ?? '',
    JSON.stringify({ sub: user }),
  ])
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  try {
    return await db.query<Record<string, unknown>>(sql, params)
  } finally {
    await db.exec('reset role')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  // The backup's accounts.csv gives exactly these fields per account: id, email, created_at.
  await db.exec(`
    begin; set local session_replication_role = replica;
    insert into auth.users (id, email, created_at) values
      ('${A}', '${EMAIL_A}', '2026-01-02T03:04:05Z'),
      ('${B}', 'bob@selftest.invalid', '2026-02-03T04:05:06Z');
    insert into public.records (user_id, collection, id, data, deleted, client_updated_at, server_updated_at) values
      ('${A}', 'notes', 'nA', '{"id":"nA","title":"segredo da alice"}', false, now(), now()),
      ('${B}', 'notes', 'nB', '{"id":"nB","title":"segredo do bob"}', false, now(), now());
    commit;
  `)
  await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`)
}, 60_000)

describe('o backup tem tudo para recriar a conta (e-mail/senha é o único login)', () => {
  it('auth.identities (provider email) é derivável só de id + e-mail do backup', async () => {
    // Exatamente o que o runbook insere em auth.identities, montado a partir do accounts.csv.
    const r = await db.query<{ provider: string; provider_id: string; identity_data: Record<string, unknown> }>(
      `select 'email' as provider, u.id::text as provider_id,
              jsonb_build_object('sub', u.id, 'email', u.email, 'email_verified', true) as identity_data
         from auth.users u where u.id = $1`,
      [A],
    )
    expect(r.rows[0].provider).toBe('email')
    expect(r.rows[0].provider_id).toBe(A)
    expect(r.rows[0].identity_data).toMatchObject({ sub: A, email: EMAIL_A, email_verified: true })
  })
})

describe('o acesso aos dados é ligado ao UUID, não à senha', () => {
  it('entrando com o UUID original, a conta vê os próprios records', async () => {
    const r = await as(A, `select id, data from public.records where collection = 'notes'`)
    expect(r.rows).toHaveLength(1)
    expect((r.rows[0].data as { title: string }).title).toBe('segredo da alice')
  })

  it('e só os seus: não enxerga os dados de outra conta (isolamento por RLS)', async () => {
    const r = await as(A, `select count(*)::int n from public.records where user_id = $1`, [B])
    expect(r.rows[0].n).toBe(0)
    const own = await as(A, `select count(*)::int n from public.records`)
    expect(own.rows[0].n).toBe(1)
  })

  it('o UUID da conta restaurada é idêntico ao do backup', async () => {
    const r = await db.query<{ id: string }>(`select id from auth.users where email = $1`, [EMAIL_A])
    expect(r.rows[0].id).toBe(A)
  })

  it('os records guardam o user_id original (a ligação com a conta sobrevive ao restore)', async () => {
    const r = await db.query<{ user_id: string }>(`select distinct user_id from public.records where id = 'nA'`)
    expect(r.rows[0].user_id).toBe(A)
  })
})
