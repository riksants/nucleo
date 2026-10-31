/**
 * Etapa 5: what the server renews (series) must be exactly what the app would schedule — same
 * keys, same moments, same texts — so whoever writes first, nothing is duplicated or shifted.
 * The series are expanded here with the same rules as the SQL (nucleo_occurs / nucleo_fire, tested
 * on Postgres in notify-sync.test.ts) and compared with buildOccurrences.
 */
import { describe, expect, it } from 'vitest'
import { buildOccurrences, buildSeries, outsideQuiet, type Series } from '../src/features/reminders/engine'
import { planSchedule, seriesSig } from '../src/features/reminders/push'
import { occursOn } from '../src/core/recurrence'
import type { DataState, Habit, RecurringItem, ReminderPrefs, RoutinePlan, Settings, SubPlan, Subscriber, Task, Tool } from '../src/data/types'
import { addDaysToDate, wallClock, zonedToInstant } from '../src/lib/zoned'

const e = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const empty = () =>
  ({
    transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [],
    plannerProfiles: [], routinePlans: [], mealPlans: [], completions: [], habits: [], recurring: [], events: [], automationRuns: [], financeGoals: [], lifePlans: [], planSteps: [], meals: [],
  }) as unknown as DataState
const settings = (reminders: Partial<ReminderPrefs> = {}, over: Partial<Settings> = {}): Settings =>
  ({
    onboarded: true, baseCurrency: 'EUR', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'Europe/Madrid',
    modules: { tasks: true, agenda: true, habits: true, recurring: true, tools: true, sales: true, subscribers: true, finance: true, projects: true, life: true, routine: true, meals: true },
    reminders: { showDetails: false, rules: {}, on: true, followUp: false, ...reminders },
    ...over,
  }) as Settings

/** JS twin of the SQL renewal for one series and one item date. */
function occurs(s: Series, d: string) {
  if (s.start && d < s.start) return false
  if (s.end && d > s.end) return false
  if (s.skip.includes(d)) return false
  const r = s.rule
  if (r.type === 'once') return d === r.date
  if (r.type === 'monthly' && 'months' in r && r.months > 1) {
    const last = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate()
    if (+d.slice(8, 10) !== Math.min(r.dayOfMonth, last) || !s.start) return false
    const m = (x: string) => +x.slice(0, 4) * 12 + +x.slice(5, 7)
    return (m(d) - m(s.start)) % r.months === 0
  }
  return occursOn(r as never, s.start ?? '', d)
}
function expand(series: Series[], from: Date, to: Date, tz: string, quiet: ReminderPrefs['quiet'] = null) {
  const out = new Map<string, number>()
  const today = wallClock(from, tz).date
  for (const s of series)
    for (let i = -1; i <= 15; i++) {
      const d = addDaysToDate(today, -s.dayOffset + i)
      if (!occurs(s, d)) continue
      const fire = outsideQuiet(new Date(zonedToInstant(addDaysToDate(d, s.dayOffset), s.time, tz).getTime() - s.minus * 60_000), quiet, tz)
      if (fire > from && fire <= to) out.set(s.template.replace('{d}', d), fire.getTime())
    }
  return out
}

const NOW = new Date('2026-10-20T10:00:00Z') // terça, 12:00 em Madri (a hora muda no domingo 25/10)
const DAY = 864e5
const bill: RecurringItem = { ...e, id: 'r1', title: 'Internet', rule: { type: 'monthly', dayOfMonth: 10 }, time: '09:00', notes: '', active: true, startDate: '2026-01-10', bill: true }
const chore: RecurringItem = { ...e, id: 'r2', title: 'Regar plantas', rule: { type: 'weekdays', days: [1, 4] }, time: '', notes: '', active: true, startDate: '2026-01-01' }
const habit: Habit = { ...e, id: 'h1', name: 'Estudar inglês', rule: { type: 'daily' }, time: '19:00', goal: '', active: true, startDate: '2026-01-01', minutes: 30 }
const tool: Tool = { ...e, id: 'tl', name: 'Spotify', link: '', plan: '', price: 1099, currency: 'EUR', billing: 'monthly', nextCharge: '2026-10-28', notes: '', status: 'active' }
const plan: SubPlan = { ...e, id: 'p1', offeringId: 'o', name: 'Mensal', price: 4500, currency: 'EUR', interval: 'monthly' }
const sub: Subscriber = { ...e, id: 'su', offeringId: 'o', planId: 'p1', name: 'Carlos', clientId: null, email: '', startDate: '2026-01-05', nextCharge: '2026-11-05', status: 'active', cancelledAt: '', payments: [] }
const routine = { ...e, id: 'routine-current', blocks: [{ id: 'b1', day: 1, start: '08:00', end: '09:00', title: 'Treino', kind: 'training', fixed: false }], done: {} } as unknown as RoutinePlan
const task: Task = { ...e, id: 't1', title: 'Entregar o site da Perfect Clean', projectId: null, dueDate: '2026-12-15', dueTime: '15:00', priority: 'none', status: 'todo', completedAt: null }
const data = (): DataState => ({ ...empty(), recurring: [bill, chore], habits: [habit], tools: [tool], subPlans: [plan], subscribers: [sub], routinePlans: [routine], tasks: [task] })

describe('séries do servidor = lembretes do app', () => {
  for (const [label, s] of [
    ['padrão', settings()],
    ['antes e na hora + horário silencioso', settings({ when: 'both', quiet: { from: '22:00', to: '07:30' } })],
    ['Dubai, completo', settings({ privacy: 'complete' }, { timeZone: 'Asia/Dubai' })],
  ] as const) {
    it(`mesmas chaves, momentos e textos (${label})`, () => {
      const series = buildSeries(data(), s, { now: NOW })
      // Mais adiante (a janela do app daqui a 30 dias, atravessando a mudança de horário):
      const later = new Date(NOW.getTime() + 30 * DAY)
      const app = buildOccurrences(data(), s, { now: later, days: 14 })
      const server = expand(series, later, new Date(later.getTime() + 14 * DAY), s.timeZone!, s.reminders?.quiet ?? null)
      const appMap = new Map(app.map((o) => [o.key, o.fireAt.getTime()]))
      // Tudo o que o servidor criaria, o app criaria igual (mesma chave, mesmo instante).
      for (const [k, t] of server) expect([k, appMap.get(k)]).toEqual([k, t])
      // E o app não tem nada repetitivo que o servidor esqueceria.
      const repeating = app.filter((o) => /^(recurring|habit|routine|tool|sub|task):/.test(o.key))
      for (const o of repeating) expect(server.has(o.key) ? o.key : `faltou ${o.key}`).toBe(o.key)
      // Textos iguais aos do app (tela bloqueada e detalhe).
      for (const o of repeating) {
        const sx = series.find((x) => {
          const [p, suf] = x.template.split('{d}')
          return o.key.startsWith(p) && o.key.slice(p.length + 10) === suf
        })
        expect(sx && [sx.title, sx.body, sx.detail]).toEqual([o.title, o.body, o.detail])
      }
    })
  }

  it('dias marcados, pulados ou com horário próprio não viram série repetida', () => {
    const moved = { ...bill, moved: { '2026-11-10': '2026-11-12' }, times: { '2026-12-10': '18:00' } }
    const s = buildSeries({ ...data(), recurring: [moved], completions: [{ ...e, id: 'recurring:r1:2027-01-10', source: 'recurring', sourceId: 'r1', date: '2027-01-10', status: 'done' }] }, settings(), { now: NOW })
    const main = s.find((x) => x.key.startsWith('recurring:r1|T09:00'))!
    expect(main.skip).toEqual(expect.arrayContaining(['2026-11-10', '2026-11-12', '2026-12-10', '2027-01-10']))
    expect(s.some((x) => x.rule.type === 'once' && x.rule.date === '2026-11-12')).toBe(true)
    expect(s.some((x) => x.rule.type === 'once' && x.rule.date === '2026-12-10' && x.template.includes('T18:00'))).toBe(true)
  })

  it('pausado, sem lembrete ou com a chave geral desligada: nenhuma série', () => {
    expect(buildSeries({ ...data(), recurring: [{ ...bill, alertsOff: true }], habits: [{ ...habit, remind: false }], tools: [{ ...tool, status: 'paused' }], subscribers: [], routinePlans: [], tasks: [] }, settings(), { now: NOW })).toEqual([])
    expect(buildSeries(data(), settings({ on: false }), { now: NOW })).toEqual([])
  })

  it('aviso próprio do registro ("2 dias antes e no dia") vale também no servidor', () => {
    const s = buildSeries({ ...empty(), recurring: [{ ...bill, alerts: [{ id: 'a', type: 'day', days: 2, at: '09:00' }, { id: 'b', type: 'at' }] }] }, settings(), { now: NOW })
    expect(s.map((x) => [x.template, x.dayOffset, x.time, x.custom])).toEqual([
      ['recurring:r1:{d}T09:00:c2d09:00', -2, '09:00', true],
      ['recurring:r1:{d}T09:00:c0', 0, '09:00', true],
    ])
  })
})

describe('plano de gravação (só o que mudou)', () => {
  const until = new Date(NOW.getTime() + 14 * DAY)
  it('não reenvia o que já está igual; remove só o que é da janela do app; preserva foco de outro aparelho e testes', () => {
    const occ = buildOccurrences(data(), settings(), { now: NOW })
    const series = buildSeries(data(), settings(), { now: NOW })
    const existing = occ.map((o) => ({ key: o.key, fire_at: o.fireAt.toISOString(), title: o.title, body: o.body, url: o.url, detail: o.detail, kind: o.kind, custom: o.custom, origin: 'app' }))
    const extra = [
      { key: 'gone:1', fire_at: new Date(NOW.getTime() + DAY).toISOString(), title: '', body: '', url: '', origin: 'app' },
      { key: 'focus:h1:x:30', fire_at: new Date(NOW.getTime() + 600_000).toISOString(), title: '', body: '', url: '', origin: 'app' },
      { key: 'test:1', fire_at: new Date(NOW.getTime() + 5000).toISOString(), title: '', body: '', url: '', origin: 'test' },
      { key: 'far:1', fire_at: new Date(until.getTime() + 3600_000).toISOString(), title: '', body: '', url: '', origin: 'series' },
    ]
    const server = new Map(series.map((s) => [s.key, seriesSig(s)]))
    const plan = planSchedule({ occurrences: occ, series, until }, [...existing, ...extra], server, new Set(), NOW.getTime())
    expect(plan.upserts).toEqual([])
    expect(plan.deletes).toEqual(['gone:1'])
    expect(plan.seriesUp).toEqual([])
    expect(plan.seriesDel).toEqual([])
    // Linha criada pelo servidor dentro da janela: o app regrava como sua (exata).
    const fromServer = existing.map((r, i) => (i === 0 ? { ...r, origin: 'series' } : r))
    expect(planSchedule({ occurrences: occ, series, until }, fromServer, server, new Set(), NOW.getTime()).upserts.map((r) => r.key)).toEqual([existing[0].key])
  })
})
