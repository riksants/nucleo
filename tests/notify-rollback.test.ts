// supabase/rollback-etapa5.sql: after the Etapa 5 migration and some use, the rollback brings back the
// old behaviour (the old app writes directly), keeps the app's reminders and the sent history, and
// removes only unsent reminders created by the server's series.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-4111-8111-111111111111'
let db: PGlite
const STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`
async function asA(sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A])
  await db.exec('set role authenticated')
  try {
    return await db.query<Record<string, unknown>>(sql, params)
  } finally {
    await db.exec('reset role')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUB)
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
  await db.query('insert into auth.users (id) values ($1)', [A])
}, 120_000)

describe('reversão da Etapa 5', () => {
  it('volta ao comportamento antigo sem perder os lembretes do app nem o histórico', async () => {
    const until = new Date(Date.now() + 3600_000).toISOString()
    const up = JSON.stringify([{ key: 'app:1', fire_at: new Date(Date.now() + 7200_000).toISOString(), title: 't', body: 'b', url: '#/tasks' }])
    const series = JSON.stringify([{ key: 's|x', template: 'rec:r1:{d}T09:00:0', rule: { type: 'daily' }, start: null, end: null, skip: [], dayOffset: 0, time: '09:00', minus: 0, kind: 'recurring', custom: false, title: 'T', body: 'B', detail: '', url: '#/recurring' }])
    const r = await asA(`select sync_notifications(null, null, $1, $2, '{}', $3, '{}', '{"tz":"Europe/Madrid"}') as r`, [until, up, series])
    expect((r.rows[0].r as { status: string }).status).toBe('ok')
    await db.query(`insert into scheduled_notifications (user_id, key, fire_at, title, body, sent_at, status) values ($1, 'old-sent', now() - interval '1 day', 't', 'b', now() - interval '1 day', 'sent')`, [A])
    const before = await db.query<{ origin: string; n: number }>('select origin, count(*)::int as n from scheduled_notifications group by origin order by origin')
    expect(before.rows.find((x) => x.origin === 'series')!.n).toBeGreaterThan(5)

    await db.exec(readFileSync('supabase/rollback-etapa5.sql', 'utf8'))

    const keys = (await db.query<{ key: string }>('select key from scheduled_notifications order by key')).rows.map((x) => x.key)
    expect(keys).toEqual(['app:1', 'old-sent'])
    // The old app writes directly again; the old dispatcher's function returns the old columns.
    await asA(`insert into scheduled_notifications (key, fire_at, title, body, url) values ('old-app', now() + interval '1 hour', 't', 'b', '#/today')`)
    await asA(`delete from scheduled_notifications where key = 'app:1'`)
    await db.exec('set role service_role')
    await db.query(`update scheduled_notifications set fire_at = now() - interval '1 minute' where key = 'old-app'`).catch(() => {})
    await db.exec('reset role')
    await db.query(`update scheduled_notifications set fire_at = now() - interval '1 minute' where key = 'old-app'`)
    await db.exec('set role service_role')
    const claimed = await db.query('select * from claim_due_notifications(10)')
    await db.exec('reset role')
    expect(claimed.fields.map((f) => f.name)).toEqual(['user_id', 'key', 'title', 'body', 'url'])
    expect(claimed.rows.length).toBe(1)
    const gone = await db.query(`select to_regclass('public.notification_series') as t, (select count(*)::int from pg_proc where proname = 'sync_notifications') as f`)
    expect(gone.rows[0]).toEqual({ t: null, f: 0 })
    // Applying the migration again after a rollback also works (idempotent).
    await db.exec(readFileSync('supabase/migrations/20261101000000_notificacoes_etapa5.sql', 'utf8'))
  })
})
