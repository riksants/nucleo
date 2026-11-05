/**
 * NÚCLEO IA — budget in dollars (migration 20261103000000_nucleo_ia.sql) on a real Postgres
 * (PGlite), with the same roles as Supabase. Covers: per-question, per-account (day / period /
 * deep analysis), global dynamic cap, anomaly breaker, plans, stale reservations, permissions
 * and isolation between accounts.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
let db: PGlite

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`

async function as(role: 'anon' | 'authenticated' | 'service_role', user: string | null, sql: string, params: unknown[] = []) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  await db.exec(`set role ${role}`)
  try {
    return await db.query<Record<string, unknown>>(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

type Res = { outcome: string; usage_id: number | null; granted: number }
const reserve = async (user: string, turn: string, step: number, model = 'haiku', wanted = 5000, min = 1000, route = 'rapida') =>
  (await as('service_role', null, 'select outcome, usage_id::int, granted::int from ia_reserve($1, $2, $3, $4, $5, $6, $7)', [user, turn, step, model, route, wanted, min])).rows[0] as unknown as Res
const settle = (id: number, cost: number, ok = true) =>
  as('service_role', null, 'select ia_settle($1, $2, $3, 100, 50, 900, 0, $4, $5)', [id, ok, cost, ['consultar_agenda'], 'end_turn'])
/** A past spending row (as if made by the function). */
const spent = (user: string, cost: number, opts: { model?: string; ago?: string; turn?: string } = {}) =>
  db.query(
    `insert into ai_usage (user_id, kind, request_id, status, model, route, turn_id, reserved_micros, cost_micros, created_at)
     values ($1, 'ia', $2, 'ok', $3, 'rapida', $4, $5, $5, now() - $6::interval)`,
    [user, `${opts.turn ?? 'past' + Math.random().toString(36).slice(2, 10)}:${Math.floor(Math.random() * 1e6)}`.slice(0, 64), opts.model ?? 'haiku', opts.turn ?? null, cost, opts.ago ?? '1 minute'],
  )
const setTier = (user: string, tier: string, validUntil: string | null = null, started = 'now()') =>
  db.query(`insert into ai_entitlements (user_id, tier, valid_until, started_at) values ($1, $2, $3, ${started})
            on conflict (user_id) do update set tier = excluded.tier, valid_until = excluded.valid_until, started_at = excluded.started_at`, [user, tier, validUntil])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const u of [A, B, C]) await db.query('insert into auth.users (id) values ($1)', [u])
  const files = readdirSync('supabase/migrations').sort()
  for (const file of files.filter((f) => f < '20261103000000')) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  // A row of the old interpreter, made before this migration: must stay as it is.
  await db.query(`insert into ai_usage (user_id, kind, request_id, status, input_tokens, output_tokens) values ($1, 'assistant', 'old-request-1', 'ok', 10, 5)`, [A])
  await db.exec(readFileSync('supabase/migrations/20261103000000_nucleo_ia.sql', 'utf8'))
}, 60_000)

beforeEach(async () => {
  await db.exec(`reset role; delete from ai_usage where kind = 'ia'; delete from ai_entitlements;`)
})

describe('migração', () => {
  it('não muda linhas antigas e o reservador antigo continua funcionando', async () => {
    const old = (await db.query(`select kind, status, input_tokens, output_tokens, cost_micros from ai_usage where request_id = 'old-request-1'`)).rows[0]
    expect(old).toEqual({ kind: 'assistant', status: 'ok', input_tokens: 10, output_tokens: 5, cost_micros: null })
    const r = (await as('service_role', null, `select outcome from ai_reserve($1, 'assistant', 'old-request-2', 30, 60)`, [B])).rows[0]
    expect(r).toEqual({ outcome: 'ok' })
    await db.query(`delete from ai_usage where request_id = 'old-request-2'`)
  })

  it('níveis padrão: grátis para todos, dono, nenhum (sem teste grátis nem assinatura)', async () => {
    const rows = (await db.query(`select tier, period_micros::int, daily_micros::int, sonnet_period_micros::int, request_haiku_micros::int, request_sonnet_micros::int from ai_tiers order by tier`)).rows
    expect(rows).toEqual([
      { tier: 'free', period_micros: 500_000, daily_micros: 50_000, sonnet_period_micros: 150_000, request_haiku_micros: 10_000, request_sonnet_micros: 100_000 },
      { tier: 'none', period_micros: 0, daily_micros: 0, sonnet_period_micros: 0, request_haiku_micros: 0, request_sonnet_micros: 0 },
      { tier: 'owner', period_micros: 5_000_000, daily_micros: 600_000, sonnet_period_micros: 3_000_000, request_haiku_micros: 10_000, request_sonnet_micros: 150_000 },
    ])
    expect((await db.query(`select column_name from information_schema.columns where table_name = 'ai_tiers' and column_name = 'trial_days'`)).rows).toEqual([])
    expect((await db.query(`select max_value::int as v from quota_limits where key = 'ia.global_hard_daily_micros'`)).rows[0]).toEqual({ v: 10_000_000 })
  })
})

describe('reserva e acerto', () => {
  it('primeiro uso: conta vira "grátis" sem prazo; reserva, acerta o custo real e libera a próxima etapa', async () => {
    const r = await reserve(A, 'turnoAAAA01', 1)
    expect(r).toMatchObject({ outcome: 'ok', granted: 5000 })
    const ent = (await db.query(`select tier, valid_until from ai_entitlements where user_id = $1`, [A])).rows[0]
    expect(ent).toEqual({ tier: 'free', valid_until: null })
    // enquanto pendente, outra pergunta da mesma conta espera
    expect((await reserve(A, 'turnoAAAA02', 1)).outcome).toBe('busy')
    await settle(r.usage_id!, 1234)
    const row = (await db.query(`select status, cost_micros::int, reserved_micros::int, input_tokens, cache_read_tokens, result from ai_usage where id = $1`, [r.usage_id])).rows[0]
    expect(row).toEqual({ status: 'ok', cost_micros: 1234, reserved_micros: 5000, input_tokens: 100, cache_read_tokens: 900, result: { tools: ['consultar_agenda'], stop: 'end_turn' } })
    expect((await reserve(A, 'turnoAAAA01', 2)).outcome).toBe('ok')
  })

  it('mesma etapa do mesmo turno nunca é cobrada duas vezes', async () => {
    const r = await reserve(A, 'turnoDUP001', 1)
    await settle(r.usage_id!, 100)
    expect((await reserve(A, 'turnoDUP001', 1)).outcome).toBe('duplicate')
  })

  it('acertar duas vezes não muda o primeiro acerto', async () => {
    const r = await reserve(A, 'turnoSET001', 1)
    await settle(r.usage_id!, 700)
    await settle(r.usage_id!, 1)
    expect((await db.query(`select cost_micros::int from ai_usage where id = $1`, [r.usage_id])).rows[0]).toEqual({ cost_micros: 700 })
  })

  it('reserva pendente esquecida conta com o valor reservado (nunca gasta a mais)', async () => {
    const r = await reserve(A, 'turnoSTALE1', 1, 'haiku', 6000)
    await db.query(`update ai_usage set created_at = now() - interval '6 minutes' where id = $1`, [r.usage_id])
    expect((await reserve(A, 'turnoSTALE2', 1)).outcome).toBe('ok')
    expect((await db.query(`select status, cost_micros::int from ai_usage where id = $1`, [r.usage_id])).rows[0]).toEqual({ status: 'error', cost_micros: 6000 })
  })
})

describe('limites da conta', () => {
  it('por pergunta: Haiku até US$ 0,01; a reserva encolhe para caber e recusa quando não cabe o mínimo', async () => {
    await spent(A, 7000, { turn: 'turnoREQ001' })
    expect(await reserve(A, 'turnoREQ001', 2, 'haiku', 5000, 1000)).toMatchObject({ outcome: 'ok', granted: 3000 })
    await db.exec(`delete from ai_usage where kind = 'ia' and status = 'pending'`)
    await spent(A, 2500, { turn: 'turnoREQ001' })
    expect((await reserve(A, 'turnoREQ001', 3, 'haiku', 5000, 1000)).outcome).toBe('limit-request')
  })

  it('por pergunta: análise profunda tem teto maior (US$ 0,10) e vale para o turno inteiro depois de escalar', async () => {
    await setTier(A, 'owner')
    await spent(A, 9000, { turn: 'turnoSON001' })
    const r = await reserve(A, 'turnoSON001', 2, 'sonnet', 60000, 5000, 'profunda')
    expect(r).toMatchObject({ outcome: 'ok', granted: 60000 })
  })

  it('por dia: grátis até US$ 0,05; volta sozinho à meia-noite (Brasília), sem custo', async () => {
    await spent(A, 49_500, { ago: '1 second' })
    expect((await reserve(A, 'turnoDAY001', 1, 'haiku', 5000, 1000)).outcome).toBe('limit-day')
    // the same spending, one minute before today's midnight in Brasília: today's limit is whole again
    await db.exec(`update ai_usage set created_at = (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '1 minute' where kind = 'ia'`)
    expect((await reserve(A, 'turnoDAY002', 1)).outcome).toBe('ok')
  })

  it('no mês: grátis até US$ 0,50 no mês do calendário; o mês anterior não conta e o limite volta no dia 1º', async () => {
    await setTier(A, 'free')
    await spent(A, 2_000_000, { ago: '40 days' })
    expect((await reserve(A, 'turnoMES001', 1)).outcome).toBe('ok')
    await db.exec(`delete from ai_usage where kind = 'ia' and status = 'pending'`)
    // 0,50 gastos neste mês (limite diário folgado só neste teste, para isolar o limite do mês)
    await db.query(`update ai_tiers set daily_micros = 5000000 where tier = 'free'`)
    try {
      await spent(A, 499_500, { ago: '1 second' })
      expect((await reserve(A, 'turnoMES002', 1, 'haiku', 5000, 1000)).outcome).toBe('limit-month')
      await db.exec(`update ai_usage set created_at = (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '1 minute' where kind = 'ia'`)
      expect((await reserve(A, 'turnoMES003', 1)).outcome).toBe('ok')
    } finally {
      await db.query(`update ai_tiers set daily_micros = 50000 where tier = 'free'`)
    }
  })

  it('grátis não vence: conta antiga continua; só um bloqueio manual com prazo vencido tira o acesso', async () => {
    await setTier(A, 'free', null, `now() - interval '400 days'`)
    expect((await reserve(A, 'turnoOLD001', 1)).outcome).toBe('ok')
    await setTier(B, 'free', new Date(Date.now() - 1000).toISOString())
    expect((await reserve(B, 'turnoBLK002', 1)).outcome).toBe('no-plan')
  })

  it('análise profunda tem orçamento próprio; esgotado, o modelo rápido continua', async () => {
    await spent(A, 149_000, { model: 'sonnet', ago: '1 second' })
    await setTier(A, 'free')
    await db.query(`update ai_tiers set daily_micros = 200000 where tier = 'free'`)
    try {
      expect((await reserve(A, 'turnoSNT001', 1, 'sonnet', 50000, 5000, 'profunda')).outcome).toBe('limit-sonnet')
      expect((await reserve(A, 'turnoSNT002', 1, 'haiku', 5000, 1000)).outcome).toBe('ok')
    } finally {
      await db.query(`update ai_tiers set daily_micros = 50000 where tier = 'free'`)
    }
  })

  it('nível "none" e Opus (desligado) não reservam nada', async () => {
    await setTier(A, 'none')
    expect((await reserve(A, 'turnoNON001', 1)).outcome).toBe('no-plan')
    await setTier(B, 'owner')
    expect((await reserve(B, 'turnoOPU001', 1, 'opus')).outcome).toBe('no-plan')
  })

  it('argumentos inválidos são recusados', async () => {
    await expect(reserve(A, 'curto', 1)).rejects.toThrow(/inválidos/)
    await expect(reserve(A, 'turnoBAD001', 0)).rejects.toThrow(/inválidos/)
    await expect(reserve(A, 'turnoBAD001', 1, 'gpt')).rejects.toThrow(/inválidos/)
  })
})

describe('global', () => {
  const cap = async () => Number((await as('service_role', null, 'select ia_global_cap()::bigint as c')).rows[0].c)

  it('o teto diário cresce com os níveis ativos e para no teto de segurança', async () => {
    expect(await cap()).toBe(1_000_000)
    await setTier(A, 'free')
    await setTier(B, 'free')
    await setTier(C, 'free', new Date(Date.now() + 86_400_000).toISOString())
    // 1.000.000 + (16.666 × 3) × 2  (US$ 0,50 por mês ÷ 30 por conta ativa)
    expect(await cap()).toBe(1_000_000 + 16_666 * 3 * 2)
    await setTier(C, 'free', new Date(Date.now() - 1000).toISOString())
    expect(await cap()).toBe(1_000_000 + 16_666 * 2 * 2)
    await db.query(`update quota_limits set max_value = 1050000 where key = 'ia.global_hard_daily_micros'`)
    try {
      expect(await cap()).toBe(1_050_000)
    } finally {
      await db.query(`update quota_limits set max_value = 10000000 where key = 'ia.global_hard_daily_micros'`)
    }
  })

  it('teto global atingido: ninguém reserva', async () => {
    await setTier(A, 'owner')
    await spent(B, 999_000, { ago: '2 hours' })
    await db.query(`update quota_limits set max_value = 100000000 where key in ('ia.pause_floor_hour_micros', 'ia.anomaly_floor_hour_micros')`)
    await db.query(`update quota_limits set max_value = 1000000 where key = 'ia.global_hard_daily_micros'`)
    try {
      expect((await reserve(A, 'turnoGLO001', 1, 'haiku', 5000, 2000)).outcome).toBe('global')
    } finally {
      await db.query(`update quota_limits set max_value = 10000000 where key = 'ia.global_hard_daily_micros'`)
      await db.query(`update quota_limits set max_value = 500000 where key = 'ia.anomaly_floor_hour_micros'`)
      await db.query(`update quota_limits set max_value = 2000000 where key = 'ia.pause_floor_hour_micros'`)
    }
  })

  it('disjuntor: pico na última hora bloqueia análise profunda; pico maior pausa a IA', async () => {
    await setTier(A, 'owner')
    await spent(B, 600_000, { ago: '10 minutes' })
    expect((await reserve(A, 'turnoANO001', 1, 'sonnet', 50000, 5000, 'profunda')).outcome).toBe('sonnet-blocked')
    expect((await reserve(A, 'turnoANO002', 1, 'haiku', 5000, 1000)).outcome).toBe('ok')
    await db.exec(`delete from ai_usage where kind = 'ia' and status = 'pending'`)
    await spent(C, 1_500_000, { ago: '5 minutes' })
    expect((await reserve(A, 'turnoANO003', 1, 'haiku', 5000, 1000)).outcome).toBe('paused')
  })
})

describe('permissões e isolamento entre contas', () => {
  it('o app (logado) não chama reservar/acertar, nem lê níveis e planos de ninguém', async () => {
    await expect(as('authenticated', A, `select * from ia_reserve('${A}', 'turnoPERM01', 1, 'haiku', 'rapida', 5000, 1000)`)).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', A, `select ia_settle(1, true, 0, 0, 0, 0, 0, null, null)`)).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', A, `select * from ai_entitlements`)).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', A, `select * from ai_tiers`)).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', A, `insert into ai_usage (user_id, kind, request_id) values ('${A}', 'ia', 'x:12345678')`)).rejects.toThrow(/permission denied/)
    await expect(as('anon', null, `select * from ia_my_usage()`)).rejects.toThrow(/permission denied/)
  })

  it('cada conta vê só o próprio uso', async () => {
    await setTier(A, 'free')
    await spent(A, 1000, { ago: '1 second' })
    await spent(B, 49_000, { ago: '1 second' })
    const mine = (await as('authenticated', A, `select tier, spent_day::int, daily::int, spent_period::int, period::int, day_resets > now() as dia_renova, extract(day from period_resets at time zone 'America/Sao_Paulo')::int as mes_renova_dia from ia_my_usage()`)).rows[0]
    expect(mine).toEqual({ tier: 'free', spent_day: 1000, daily: 50_000, spent_period: 1000, period: 500_000, dia_renova: true, mes_renova_dia: 1 })
    const rows = (await as('authenticated', A, `select user_id from ai_usage where kind = 'ia'`)).rows
    expect(rows.every((r) => r.user_id === A)).toBe(true)
    const none = (await as('authenticated', C, `select tier, spent_day::int from ia_my_usage()`)).rows[0]
    expect(none).toEqual({ tier: 'free', spent_day: 0 })
  })

  it('o gasto de uma conta não consome o limite pessoal de outra', async () => {
    await spent(B, 79_900, { ago: '1 hour' })
    expect((await reserve(A, 'turnoISO001', 1)).outcome).toBe('ok')
  })

  it('excluir a conta apaga o plano dela (cascata)', async () => {
    await db.query(`insert into auth.users (id) values ('44444444-4444-4444-8444-444444444444')`)
    await setTier('44444444-4444-4444-8444-444444444444', 'owner')
    await db.query(`delete from auth.users where id = '44444444-4444-4444-8444-444444444444'`)
    expect((await db.query(`select count(*)::int as n from ai_entitlements where user_id = '44444444-4444-4444-8444-444444444444'`)).rows[0]).toEqual({ n: 0 })
  })
})

describe('desligar e reverter (roteiro de publicação)', () => {
  it('teto global zero pausa a IA; a reversão tira tudo da IA e o reservador antigo continua', async () => {
    const fresh = new PGlite()
    await fresh.exec(SUPABASE_STUB)
    await fresh.query('insert into auth.users (id) values ($1)', [A])
    for (const f of readdirSync('supabase/migrations').sort()) await fresh.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
    await fresh.exec(`update public.quota_limits set max_value = 0 where key = 'ia.global_hard_daily_micros'`)
    const paused = (await fresh.query<{ outcome: string }>(`select outcome from ia_reserve($1, 'turno-pausa-01', 1, 'haiku', 'rapida', 1000, 100)`, [A])).rows[0]
    expect(paused.outcome).toBe('global')
    await fresh.exec(readFileSync('supabase/rollback-nucleo-ia.sql', 'utf8'))
    const left = (await fresh.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname like 'ia\_%'`)).rows[0].n
    expect(left).toBe(0)
    expect((await fresh.query(`select 1 from information_schema.tables where table_name in ('ai_tiers', 'ai_entitlements')`)).rows).toEqual([])
    const r = (await fresh.query<{ outcome: string }>(`select outcome from ai_reserve($1, 'assistant', 'old-after-rollback', 30, 60)`, [A])).rows[0]
    expect(r.outcome).toBe('ok')
  })
})
