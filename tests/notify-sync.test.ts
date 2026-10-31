/**
 * Etapa 5 (migration 20261101000000_notificacoes_etapa5.sql) on a real Postgres (PGlite):
 * revision check (an outdated device can't overwrite, recreate or delete), server renewal of
 * series with the same keys as the app, dispatch results and the person's marks.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

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

async function as(user: string | null, sql: string, params: unknown[] = [], role = user ? 'authenticated' : 'anon') {
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

const iso = (ms: number) => new Date(ms).toISOString()
const H = 3600_000
const D = 24 * H

interface SyncArgs {
  cursor: string | null
  settingsAt?: string | null
  until?: string
  upserts?: object[]
  deletes?: string[]
  series?: object[]
  seriesDeletes?: string[]
  tz?: string
  quiet?: { from: string; to: string } | null
}
async function sync(user: string, a: SyncArgs) {
  const res = await as(user, `select sync_notifications($1, $2, $3, $4, $5, $6, $7, $8) as r`, [
    a.cursor,
    a.settingsAt ?? null,
    a.until ?? iso(Date.now() + 14 * D),
    JSON.stringify(a.upserts ?? []),
    a.deletes ?? [],
    JSON.stringify(a.series ?? []),
    a.seriesDeletes ?? [],
    JSON.stringify({ tz: a.tz ?? 'Europe/Madrid', quietFrom: a.quiet?.from ?? null, quietTo: a.quiet?.to ?? null }),
  ])
  return (res.rows[0].r as { status: string }).status
}
const rows = async (user: string) =>
  (await db.query<{ key: string; fire_at: Date; title: string; origin: string; status: string; sent_at: Date | null; series_key: string | null }>(
    'select key, fire_at, title, origin, status, sent_at, series_key from scheduled_notifications where user_id = $1 order by fire_at, key',
    [user],
  )).rows
/** Latest change the device "downloaded" (what the app sends as its cursor). */
const cursorOf = async (user: string) =>
  ((await db.query<{ c: Date | null }>('select max(server_updated_at) as c from records where user_id = $1', [user])).rows[0].c as Date | null)?.toISOString() ?? null
const putRecord = (user: string, id: string) =>
  as(user, `insert into records (collection, id, data, client_updated_at) values ('tasks', $1, '{}', now())
            on conflict (user_id, collection, id) do update set data = excluded.data, client_updated_at = excluded.client_updated_at`, [id])

const row = (key: string, fireIn: number, extra: object = {}) => ({ key, fire_at: iso(Date.now() + fireIn), title: 'Pagar: Internet', body: 'Pagar Internet hoje', url: '#/recurring?open=r1', kind: 'recurring', detail: 'Pagar Internet hoje', ...extra })

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [A, B])
}, 120_000)

beforeEach(async () => {
  await db.exec('delete from scheduled_notifications; delete from notification_series; delete from notification_state; delete from records; delete from user_settings;')
})

describe('revisão: aparelho desatualizado não mexe em nada', () => {
  it('aparelho em dia grava; app não escreve direto na tabela', async () => {
    await putRecord(A, 't1')
    expect(await sync(A, { cursor: await cursorOf(A), upserts: [row('k1', H)] })).toBe('ok')
    expect((await rows(A)).map((r) => r.key)).toEqual(['k1'])
    await expect(as(A, `insert into scheduled_notifications (key, fire_at, title, body) values ('x', now() + interval '1 hour', 't', 'b')`)).rejects.toThrow(/permission denied/)
    await expect(as(A, `delete from scheduled_notifications`)).rejects.toThrow(/permission denied/)
  })

  it('registro mais novo que o aparelho baixou: recusa (não recria, não apaga, não sobrescreve)', async () => {
    await putRecord(A, 't1')
    const old = await cursorOf(A)
    expect(await sync(A, { cursor: old, upserts: [row('k1', H), row('k2', 2 * H)] })).toBe('ok')
    await new Promise((r) => setTimeout(r, 5))
    await putRecord(A, 't2') // outro aparelho mudou algo depois
    expect(await sync(A, { cursor: old, upserts: [row('k3', H)], deletes: ['k1'] })).toBe('stale')
    expect(await sync(A, { cursor: old, upserts: [row('k2', 5 * H, { title: 'versão velha' })] })).toBe('stale')
    const r = await rows(A)
    expect(r.map((x) => x.key)).toEqual(['k1', 'k2'])
    expect(r.find((x) => x.key === 'k2')!.title).toBe('Pagar: Internet')
  })

  it('base mais antiga que a última aceita: recusa mesmo sem registro novo visível', async () => {
    await putRecord(A, 't1')
    const c1 = await cursorOf(A)
    await new Promise((r) => setTimeout(r, 5))
    await putRecord(A, 't2')
    const c2 = await cursorOf(A)
    expect(await sync(A, { cursor: c2 })).toBe('ok')
    // Registro apagado de vez (sem rastro): só a base gravada denuncia o aparelho antigo.
    await db.query(`delete from records where user_id = $1 and id = 't2'`, [A])
    expect(await sync(A, { cursor: c1, upserts: [row('k9', H)] })).toBe('stale')
    expect(await rows(A)).toEqual([])
  })

  it('configurações mais novas no servidor também tornam o aparelho desatualizado', async () => {
    await as(A, `insert into user_settings (data, client_updated_at) values ('{}', $1)`, [iso(Date.now())])
    expect(await sync(A, { cursor: null, settingsAt: iso(Date.now() - D), upserts: [row('k1', H)] })).toBe('stale')
    expect(await sync(A, { cursor: null, settingsAt: iso(Date.now() + 1000), upserts: [row('k1', H)] })).toBe('ok')
  })

  it('lembrete já enviado nunca é alterado nem apagado pelo app', async () => {
    expect(await sync(A, { cursor: null, upserts: [row('k1', H)] })).toBe('ok')
    await db.query(`update scheduled_notifications set sent_at = now(), status = 'sent' where key = 'k1'`)
    expect(await sync(A, { cursor: null, upserts: [row('k1', 3 * H, { title: 'outro' })], deletes: ['k1'] })).toBe('ok')
    const [r] = await rows(A)
    expect(r.title).toBe('Pagar: Internet')
    expect(r.status).toBe('sent')
  })

  it('isolamento: B não vê nem apaga o que é de A', async () => {
    expect(await sync(A, { cursor: null, upserts: [row('k1', H)], series: [] })).toBe('ok')
    expect(await sync(B, { cursor: null, deletes: ['k1'] })).toBe('ok')
    expect((await rows(A)).length).toBe(1)
    expect((await as(B, 'select * from scheduled_notifications')).rows).toEqual([])
    expect((await as(B, 'select user_id from notification_state')).rows).toEqual([{ user_id: B }])
  })
})

/** A monthly bill on the 10th at 09:00 (Madrid), reminded on the day. */
const bill = (over: object = {}) => ({
  key: 'recurring:r1|T09:00:0',
  template: 'recurring:r1:{d}T09:00:0',
  rule: { type: 'daily' },
  start: null,
  end: null,
  skip: [],
  dayOffset: 0,
  time: '09:00',
  minus: 0,
  kind: 'recurring',
  custom: false,
  title: 'Conta: Internet',
  body: 'Agora: Internet',
  detail: 'Agora: Internet',
  url: '#/recurring?open=r1',
  ...over,
})

describe('séries renovadas pelo servidor', () => {
  it('cria as próximas ocorrências só depois do que o app cobriu, com as chaves do app', async () => {
    const until = iso(Date.now() + 2 * D)
    expect(await sync(A, { cursor: null, until, series: [bill()] })).toBe('ok')
    const r = await rows(A)
    expect(r.length).toBeGreaterThanOrEqual(11)
    expect(r.length).toBeLessThanOrEqual(13)
    expect(r.every((x) => x.origin === 'series' && x.series_key === 'recurring:r1|T09:00:0')).toBe(true)
    expect(r.every((x) => x.fire_at.getTime() > Date.parse(until) && x.fire_at.getTime() <= Date.now() + 14 * D)).toBe(true)
    // 09:00 em Madri, com horário de verão: a hora local nunca desliza.
    const local = r.map((x) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(x.fire_at))
    expect(new Set(local)).toEqual(new Set(['09:00']))
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(r[0].fire_at)
    expect(r[0].key).toBe(`recurring:r1:${d}T09:00:0`)
    // Rodar de novo não duplica.
    await db.query('select renew_notifications(null)')
    expect((await rows(A)).length).toBe(r.length)
  })

  it('o que o app gravou vence; dias pulados e fim da série são respeitados', async () => {
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + 5 * D))
    const exact = { key: `recurring:r1:${tomorrow}T09:00:0`, fire_at: iso(Date.now() + 5 * D), title: 'exato do app', body: 'b', url: '' }
    // A janela do app termina antes desse dia, mas ele já gravou essa ocorrência (por exemplo, horário próprio).
    expect(await sync(A, { cursor: null, until: iso(Date.now() + H), upserts: [exact], series: [bill({ skip: [], end: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + 8 * D)) })] })).toBe('ok')
    const r = await rows(A)
    expect(r.find((x) => x.key === exact.key)!.title).toBe('exato do app')
    expect(r.length).toBeLessThanOrEqual(9)
    const skipDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + 3 * D))
    expect(await sync(A, { cursor: null, until: iso(Date.now() + H), series: [bill({ skip: [skipDay] })] })).toBe('ok')
    expect((await rows(A)).some((x) => x.key === `recurring:r1:${skipDay}T09:00:0`)).toBe(false)
  })

  it('série removida leva junto as ocorrências futuras criadas pelo servidor', async () => {
    expect(await sync(A, { cursor: null, until: iso(Date.now() + H), series: [bill()] })).toBe('ok')
    expect((await rows(A)).length).toBeGreaterThan(10)
    expect(await sync(A, { cursor: null, until: iso(Date.now() + H), seriesDeletes: ['recurring:r1|T09:00:0'] })).toBe('ok')
    expect(await rows(A)).toEqual([])
  })

  it('regras: dias da semana, todo dia N (fim de mês), anual, a cada N dias, data única', async () => {
    const q = async (rule: object, start: string | null, d: string) => (await db.query<{ v: boolean }>('select nucleo_occurs($1, $2, $3) as v', [JSON.stringify(rule), start, d])).rows[0].v
    expect(await q({ type: 'weekdays', days: [1, 3] }, null, '2026-11-02')).toBe(true) // segunda
    expect(await q({ type: 'weekdays', days: [1, 3] }, null, '2026-11-03')).toBe(false)
    expect(await q({ type: 'monthly', dayOfMonth: 31 }, null, '2027-02-28')).toBe(true)
    expect(await q({ type: 'monthly', dayOfMonth: 31 }, null, '2027-02-27')).toBe(false)
    expect(await q({ type: 'monthly', dayOfMonth: 10, months: 12 }, '2026-11-10', '2027-11-10')).toBe(true)
    expect(await q({ type: 'monthly', dayOfMonth: 10, months: 12 }, '2026-11-10', '2027-05-10')).toBe(false)
    expect(await q({ type: 'interval', every: 3, unit: 'day' }, '2026-11-01', '2026-11-07')).toBe(true)
    expect(await q({ type: 'interval', every: 2, unit: 'week' }, '2026-11-01', '2026-11-08')).toBe(false)
    expect(await q({ type: 'once', date: '2026-12-24' }, null, '2026-12-24')).toBe(true)
    expect(await q({ type: 'nova-regra' }, null, '2026-12-24')).toBe(false)
  })

  it('momento: horário de verão e horário silencioso iguais ao app', async () => {
    const fire = async (date: string, time: string, minus: number, tz: string, from: string | null, to: string | null) =>
      ((await db.query<{ f: Date }>('select nucleo_fire($1, $2, $3, $4, $5, $6) as f', [date, time, minus, tz, from, to])).rows[0].f as Date).toISOString()
    expect(await fire('2026-03-29', '09:00', 0, 'Europe/Madrid', null, null)).toBe('2026-03-29T07:00:00.000Z') // já em CEST
    expect(await fire('2026-03-28', '09:00', 0, 'Europe/Madrid', null, null)).toBe('2026-03-28T08:00:00.000Z')
    expect(await fire('2026-11-10', '09:00', 15, 'America/Sao_Paulo', null, null)).toBe('2026-11-10T11:45:00.000Z')
    expect(await fire('2026-11-10', '09:00', 0, 'Asia/Dubai', null, null)).toBe('2026-11-10T05:00:00.000Z')
    // 22:30 com silêncio 22:00→07:00 vai para 07:00 do dia seguinte; 06:00 vai para 07:00 do mesmo dia.
    expect(await fire('2026-11-10', '22:30', 0, 'Europe/Madrid', '22:00', '07:00')).toBe('2026-11-11T06:00:00.000Z')
    expect(await fire('2026-11-10', '06:00', 0, 'Europe/Madrid', '22:00', '07:00')).toBe('2026-11-10T06:00:00.000Z')
  })
})

describe('envio, histórico e marcas', () => {
  it('claim → resultado por lembrete; nunca enviado a tempo vira expirado', async () => {
    expect(await sync(A, { cursor: null, upserts: [row('k1', 2000), row('k2', H)] })).toBe('ok')
    await db.query(`update scheduled_notifications set fire_at = now() - interval '1 minute' where key = 'k1'`)
    await db.query(`insert into scheduled_notifications (user_id, key, fire_at, title, body) values ($1, 'velho', now() - interval '7 hours', 't', 'b')`, [A])
    await db.exec('set role service_role')
    const claimed = (await db.query<{ key: string; kind: string; custom: boolean }>('select * from claim_due_notifications(10)')).rows
    expect(claimed.map((c) => c.key)).toEqual(['k1'])
    expect(claimed[0].kind).toBe('recurring')
    await db.query(`select record_dispatch($1)`, [JSON.stringify([{ user_id: A, key: 'k1', status: 'sent', sent: 2, failed: 1, error: 'um aparelho recusou' }])])
    await db.query('select renew_notifications(null)')
    await db.exec('reset role')
    const r = await rows(A)
    expect(r.find((x) => x.key === 'k1')).toMatchObject({ status: 'sent' })
    expect(r.find((x) => x.key === 'velho')).toMatchObject({ status: 'expired', sent_at: null })
    expect(r.find((x) => x.key === 'k2')).toMatchObject({ status: 'scheduled', sent_at: null })
  })

  it('app não chama funções do dispatcher', async () => {
    await expect(as(A, 'select * from claim_due_notifications(10)')).rejects.toThrow(/permission denied/)
    await expect(as(A, `select record_dispatch('[]')`)).rejects.toThrow(/permission denied/)
    await expect(as(A, 'select renew_notifications(null)')).rejects.toThrow(/permission denied/)
  })

  it('dispensar, restaurar e visto; teste limitado a 5 por hora', async () => {
    expect(await sync(A, { cursor: null, upserts: [row('k1', H)] })).toBe('ok')
    await db.query(`update scheduled_notifications set sent_at = now(), status = 'sent'`)
    await as(A, `select mark_notifications(array['k1'], 'dismiss')`)
    expect((await db.query<{ d: Date | null; s: Date | null }>('select dismissed_at as d, seen_at as s from scheduled_notifications')).rows[0].d).not.toBeNull()
    await as(A, `select mark_notifications(array['k1'], 'restore')`)
    expect((await db.query<{ d: Date | null }>('select dismissed_at as d from scheduled_notifications')).rows[0].d).toBeNull()
    // B não marca o de A.
    await as(B, `select mark_notifications(array['k1'], 'dismiss')`)
    expect((await db.query<{ d: Date | null }>('select dismissed_at as d from scheduled_notifications')).rows[0].d).toBeNull()
    for (let i = 0; i < 5; i++) {
      await as(A, 'select send_test_notification()')
      await new Promise((r) => setTimeout(r, 1100))
    }
    await expect(as(A, 'select send_test_notification()')).rejects.toThrow(/quota_exceeded:notifications.test/)
  }, 30_000)
})
