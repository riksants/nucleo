/**
 * PARTE 6: migration 20261107000000_validacao_dinheiro.sql on a real Postgres (PGlite), writing as the user the
 * way PostgREST does. Malformed money values (text, objects, huge, fractional cents, negative, invented type)
 * used to be accepted and broke Início/Finanças/Projetos/Vendas on every device of the account.
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

/** Writes one record as user A; returns the error message, or null when accepted. */
async function put(collection: string, data: Record<string, unknown>, deleted = false): Promise<string | null> {
  const id = `r${++n}`
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A])
  await db.exec('set role authenticated')
  try {
    await db.query(`insert into records (collection, id, data, deleted, client_updated_at) values ($1, $2, $3, $4, now())`, [collection, id, JSON.stringify({ id, ...data }), deleted])
    return null
  } catch (e) {
    return (e as Error).message
  } finally {
    await db.exec('reset role')
  }
}
const tx = (extra: Record<string, unknown>) => ({ type: 'out', amount: 1250, currency: 'BRL', baseAmount: -1250, reason: 'Café', ...extra })
const refused = expect.stringMatching(/records_money_shape/)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.query(`insert into auth.users (id) values ($1)`, [A])
}, 180_000)

describe('dinheiro validado no banco (PARTE 6)', () => {
  it('aceita o que o app grava (inclusive ajuste negativo em baseAmount e campos opcionais ausentes)', async () => {
    expect(await put('transactions', tx({}))).toBeNull()
    expect(await put('transactions', tx({ type: 'adjust', amount: 5000, baseAmount: -5000 }))).toBeNull()
    expect(await put('transactions', tx({ type: 'in', amount: 0, baseAmount: 0, category: 'refund' }))).toBeNull()
    expect(await put('projects', { name: 'Site', charged: 100000, received: 0, payments: [{ id: 'p', amount: 20000 }] })).toBeNull()
    expect(await put('projects', { name: 'Sem valores' })).toBeNull()
    expect(await put('sales', { total: 9900, discount: 100, quantity: 1.5, items: [{ price: 5000, quantity: 2 }], payments: [], installments: [{ amount: 4900 }] })).toBeNull()
    expect(await put('financeGoals', { target: 100000, saved: 5000, history: [{ date: '2026-11-01', saved: 5000 }] })).toBeNull()
    expect(await put('tools', { price: 3990 })).toBeNull()
    expect(await put('goals', { price: null })).toBeNull()
    expect(await put('subPlans', { price: 1990 })).toBeNull()
  })

  it('recusa tipo inválido: texto, objeto ou ausência onde vai dinheiro', async () => {
    expect(await put('transactions', tx({ amount: 'abc', baseAmount: 'abc' }))).toEqual(refused)
    expect(await put('transactions', tx({ amount: { x: 1 } }))).toEqual(refused)
    expect(await put('transactions', { type: 'out', currency: 'BRL', reason: 'sem valor' })).toEqual(refused)
    expect(await put('projects', { charged: '100' })).toEqual(refused)
    expect(await put('tools', { price: true })).toEqual(refused)
    expect(await put('sales', { total: [1] })).toEqual(refused)
  })

  it('recusa número inválido: gigantesco, centavos quebrados, negativo onde não faz sentido', async () => {
    expect(await put('transactions', tx({ amount: 1e300, baseAmount: 1e300 }))).toEqual(refused)
    expect(await put('transactions', tx({ amount: 12.5, baseAmount: -12.5 }))).toEqual(refused)
    expect(await put('transactions', tx({ amount: -100 }))).toEqual(refused)
    expect(await put('sales', { payments: [{ amount: -5 }] })).toEqual(refused)
    expect(await put('sales', { items: [{ price: 100, quantity: -1 }] })).toEqual(refused)
    expect(await put('sales', { quantity: 5_000_000 })).toEqual(refused)
    expect(await put('financeGoals', { target: 1e14 })).toEqual(refused)
    expect(await put('projects', { payments: [{ amount: 'abc' }] })).toEqual(refused)
  })

  it('recusa enum inventado e moeda inválida em movimentações', async () => {
    expect(await put('transactions', tx({ type: 'hack' }))).toEqual(refused)
    expect(await put('transactions', tx({ currency: '<b>' }))).toEqual(refused)
    expect(await put('transactions', tx({ currency: 'brl' }))).toEqual(refused)
  })

  it('recusa listas que não são listas (o app as percorre)', async () => {
    expect(await put('sales', { payments: 'abc' })).toEqual(refused)
    expect(await put('projects', { payments: { amount: 1 } })).toEqual(refused)
    expect(await put('financeGoals', { history: 5 })).toEqual(refused)
    expect(await put('sales', { payments: ['abc'] })).toEqual(refused)
    expect(await put('transactions', tx({ amount: [5] }))).toEqual(refused)
    // a bad item after a good one is still caught; an item without the field is fine
    expect(await put('projects', { payments: [{ id: 'a', note: '' }, { id: 'b', amount: 'x' }] })).toEqual(refused)
    expect(await put('projects', { payments: [{ id: 'a', note: '' }, { id: 'b', amount: 500 }] })).toBeNull()
  })

  it('lápide de item apagado e outras coleções não mudam', async () => {
    expect(await put('transactions', {}, true)).toBeNull()
    expect(await put('notes', { title: '<img src=x onerror=alert(1)>', amount: 'texto livre numa nota' })).toBeNull()
  })

  it('XSS armazenado: o texto é guardado exatamente como digitado (a proteção é na exibição, pelo React)', async () => {
    const title = `<script>alert(1)</script> "><img src=x onerror=alert(1)>`
    expect(await put('notes', { title })).toBeNull()
    const row = (await db.query<{ t: string }>(`select data->>'title' t from records where data->>'title' like '%<script>%' limit 1`)).rows[0]
    expect(row.t).toBe(title)
  })
})
