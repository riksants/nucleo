/**
 * PARTE 12: cobertura da constraint records_no_plain_password (definida no CREATE TABLE records da migration
 * inicial 20261001000000_nucleo_init.sql) num Postgres real (PGlite), escrevendo como o usuário faz via
 * PostgREST. O banco recusa senha do Cofre em texto aberto (data->>'password' não vazio em collection
 * accounts); a senha de verdade só existe cifrada em data->'secret' (AES-GCM). A proteção fica no PostgreSQL,
 * não só no frontend — nem a service_role grava plaintext (CHECK vale mesmo para bypassrls). Complementa
 * tests/rls.test.ts com os casos de UPDATE, service_role, outras collections, tombstone e formato do secret.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-4111-8111-111111111111'
let db: PGlite
let n = 0

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

const validSecret = { v: 1, iv: 'YWJjZGVmZ2hpamts', ct: 'c2VhbGVkLWNpcGhlcnRleHQ=' }

/** Inserts one record as the given role (default authenticated); returns the error message, or null when accepted. */
async function put(collection: string, data: Record<string, unknown>, { deleted = false, role = 'authenticated' } = {}): Promise<{ id: string; err: string | null }> {
  const id = `r${++n}`
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A])
  await db.exec(`set role ${role}`)
  try {
    await db.query(`insert into records (collection, id, data, deleted, client_updated_at) values ($1, $2, $3, $4, now())`, [collection, id, JSON.stringify({ id, ...data }), deleted])
    return { id, err: null }
  } catch (e) {
    return { id, err: (e as Error).message }
  } finally {
    await db.exec('reset role')
  }
}

/** Updates an existing record's data as authenticated; returns the error message, or null when accepted. */
async function patch(collection: string, id: string, data: Record<string, unknown>): Promise<string | null> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A])
  await db.exec('set role authenticated')
  try {
    await db.query(`update records set data = $3, client_updated_at = now() where collection = $1 and id = $2`, [collection, id, JSON.stringify({ id, ...data })])
    return null
  } catch (e) {
    return (e as Error).message
  } finally {
    await db.exec('reset role')
  }
}

const refused = expect.stringMatching(/records_no_plain_password/)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  // No Supabase real a service_role tem acesso total à tabela (e bypassrls); aqui concedemos o mesmo,
  // para o teste da service_role chegar até a CHECK (constraints valem mesmo para bypassrls).
  await db.exec('grant select, insert, update, delete on public.records to service_role')
  await db.query(`insert into auth.users (id) values ($1)`, [A])
}, 180_000)

describe('senha do Cofre sem plaintext no banco (PARTE 12)', () => {
  it('recusa accounts com password em texto aberto', async () => {
    expect((await put('accounts', { name: 'Gmail', password: 'segredo-em-texto' })).err).toEqual(refused)
  })

  it('recusa accounts com plaintext MESMO tendo secret válido (o objetivo é 0 plaintext)', async () => {
    expect((await put('accounts', { name: 'Gmail', password: 'ainda-texto', secret: validSecret })).err).toEqual(refused)
  })

  it('aceita accounts com senha cifrada em secret e password vazio', async () => {
    expect((await put('accounts', { name: 'Gmail', password: '', secret: validSecret })).err).toBeNull()
  })

  it('aceita accounts sem campo password (ausente) e sem secret', async () => {
    expect((await put('accounts', { name: 'Só anotação', notes: 'sem senha' })).err).toBeNull()
  })

  it('aceita accounts com password explicitamente vazio', async () => {
    expect((await put('accounts', { name: 'Serviço', password: '' })).err).toBeNull()
  })

  it('não afeta outras collections (um campo "password" fora de accounts passa)', async () => {
    // nota com a palavra password no corpo: não é o Cofre, não é barrado por esta regra
    expect((await put('notes', { title: 'x', body: 'password do wifi', password: 'irrelevante' })).err).toBeNull()
    expect((await put('transactions', { type: 'out', amount: 1250, currency: 'BRL', baseAmount: -1250, reason: 'Café' })).err).toBeNull()
  })

  it('tombstone de accounts apagado (data sem password) continua sendo aceito', async () => {
    expect((await put('accounts', {}, { deleted: true })).err).toBeNull()
  })

  it('bloqueia também a service_role (proteção no banco, não só no app)', async () => {
    expect((await put('accounts', { name: 'Gmail', password: 'texto', secret: validSecret }, { role: 'service_role' })).err).toEqual(refused)
  })

  it('UPDATE que tenta introduzir plaintext numa conta selada é recusado; selar de volta funciona', async () => {
    const { id, err } = await put('accounts', { name: 'Conta', password: '', secret: validSecret })
    expect(err).toBeNull()
    // tentar reabrir plaintext por update → recusado
    expect(await patch('accounts', id, { name: 'Conta', password: 'voltou-texto', secret: validSecret })).toEqual(refused)
    // editar mantendo selado (password vazio) → aceito
    expect(await patch('accounts', id, { name: 'Conta renomeada', password: '', secret: validSecret })).toBeNull()
  })

  it('a constraint de formato do secret (B5) continua valendo junto desta', async () => {
    // secret malformado (sem ct string) é barrado pela records_accounts_secret_shape, não por esta
    const { err } = await put('accounts', { name: 'x', password: '', secret: { v: 1, iv: 'abc' } })
    expect(err).toEqual(expect.stringMatching(/records_accounts_secret_shape/))
  })
})
