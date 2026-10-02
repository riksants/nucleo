import { describe, expect, it } from 'vitest'
import { challengeState, CHALLENGE_TEMPLATES } from '../src/core/challenges'
import { completionId, indexCompletions } from '../src/core/completions'
import { metricValue, percent, weekMetrics } from '../src/core/metrics'
import { todayIn, weekStart } from '../src/core/period'
import { buildSnapshot, isClosable, weeksToClose } from '../src/core/snapshots'
import { occurrenceStreak, weekStreak } from '../src/core/streaks'
import { goalProgress } from '../src/core/weekGoals'
import type { Challenge, Completion, DataState, Settings, WeeklyGoal } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], weeklyGoals: [], challenges: [], weekCheckins: [], weekSnapshots: [], financeGoals: [], lifePlans: [], planSteps: [] })
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '2026-01-01T00:00:00Z', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { habits: true, routine: true, recurring: true, agenda: true } } as Settings
const e = { createdAt: '', updatedAt: '' }
const done = (source: Completion['source'], id: string, date: string, status: Completion['status'] = 'done'): Completion => ({ ...e, id: completionId(source, id, date), source, sourceId: id, date, status })
// Quinta 1/out/2026 15:00 em SP. Semana: seg 28/set → dom 4/out.
const NOW = new Date('2026-10-01T18:00:00Z')
const WEEK = '2026-09-28'

function trainingData(): DataState {
  const d = empty()
  d.habits = [{ ...e, id: 'treino', name: 'Treinar', rule: { type: 'weekdays', days: [1, 3, 5] }, time: '', goal: '', active: true, startDate: '2026-09-27', category: 'training' }]
  d.routinePlans = [{ ...e, createdAt: '2026-09-27T12:00:00Z', id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks: [{ id: 'gym', day: 1, start: '07:00', end: '08:00', title: 'Musculação', kind: 'training', fixed: true }, { id: 'est', day: 2, start: '19:00', end: '20:30', title: 'Inglês', kind: 'study', fixed: true }] }]
  // Seg: rotina de treino E hábito de treino (mesmo dia) · Ter: estudo · Qua: hábito de treino
  d.completions = [done('routine', 'gym', '2026-09-28'), done('habit', 'treino', '2026-09-28'), done('routine', 'est', '2026-09-29'), done('habit', 'treino', '2026-09-30')]
  return d
}

describe('semana no fuso do usuário', () => {
  it('a semana vira de domingo para segunda no fuso escolhido, não no do aparelho', () => {
    const instant = new Date('2026-10-05T01:30:00Z') // dom 22:30 em SP; seg 05:30 em Dubai
    expect(weekStart(todayIn('America/Sao_Paulo', instant))).toBe('2026-09-28')
    expect(weekStart(todayIn('Asia/Dubai', instant))).toBe('2026-10-05')
  })
})

describe('métricas da semana', () => {
  it('treino conta no máximo uma vez por dia (rotina + hábito no mesmo dia = 1)', () => {
    const m = weekMetrics(trainingData(), settings, WEEK, NOW)
    expect(m.training.done).toBe(2) // segunda e quarta
    expect(m.training.planned).toBe(2) // seg e qua; sexta ainda não chegou
    expect(metricValue(m, 'training.days')).toBe(2)
    expect(m.study.minutes).toBe(90)
    expect(m.study.days).toBe(1)
  })

  it('hoje pendente não conta como falha; dias futuros não contam', () => {
    const d = empty()
    d.habits = [{ ...e, id: 'agua', name: 'Água', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-01-01' }]
    d.completions = [done('habit', 'agua', '2026-09-28'), done('habit', 'agua', '2026-09-29'), done('habit', 'agua', '2026-09-30', 'skipped')]
    const m = weekMetrics(d, settings, WEEK, NOW)
    // seg feito, ter feito, qua pulado (fora da conta), qui hoje pendente (fora) → 2/2
    expect(m.habits).toMatchObject({ expected: 2, done: 2, skipped: 1 })
    expect(percent(m.habits)).toBe(100)
  })

  it('sem movimentações, finanças ficam sem dados (não zero)', () => {
    expect(metricValue(weekMetrics(empty(), { ...settings, modules: { ...settings.modules, finance: true } }, WEEK, NOW), 'finance.net')).toBeNull()
  })

  it('saldo da semana usa entradas − saídas na moeda do saldo, pelo dia no fuso', () => {
    const d = empty()
    d.transactions = [
      { ...e, id: 'a', createdAt: '2026-09-29T15:00:00Z', type: 'in', amount: 50000, currency: 'BRL', baseAmount: 50000, reason: 'r' },
      { ...e, id: 'b', createdAt: '2026-09-30T15:00:00Z', type: 'out', amount: 20000, currency: 'BRL', baseAmount: -20000, reason: 'r' },
      { ...e, id: 'c', createdAt: '2026-09-28T02:00:00Z', type: 'out', amount: 999, currency: 'BRL', baseAmount: -999, reason: 'domingo 23h em SP: semana anterior' },
    ]
    expect(weekMetrics(d, { ...settings, modules: { finance: true } }, WEEK, NOW).finance).toMatchObject({ income: 50000, expense: 20000, net: 30000 })
  })
})

describe('sequências', () => {
  const habit = { rule: { type: 'weekdays' as const, days: [1, 3, 5] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[] }, start: '2026-09-01' }
  it('hábito seg/qua/sex não perde sequência na terça nem na quinta', () => {
    const idx = indexCompletions([done('habit', 'h', '2026-09-21'), done('habit', 'h', '2026-09-23'), done('habit', 'h', '2026-09-25'), done('habit', 'h', '2026-09-28'), done('habit', 'h', '2026-09-30')])
    expect(occurrenceStreak('habit', 'h', habit.rule, habit.start, idx, '2026-10-01').current).toBe(5)
  })
  it('pulado é pausa: não soma e não quebra; hoje pendente não quebra', () => {
    const idx = indexCompletions([done('habit', 'h', '2026-09-28'), done('habit', 'h', '2026-09-29', 'skipped'), done('habit', 'h', '2026-09-30')])
    expect(occurrenceStreak('habit', 'h', { type: 'daily' }, '2026-09-01', idx, '2026-10-01').current).toBe(2)
  })
  it('um dia esperado sem marcar encerra a sequência atual (o histórico continua)', () => {
    const idx = indexCompletions([done('habit', 'h', '2026-09-27'), done('habit', 'h', '2026-09-29'), done('habit', 'h', '2026-09-30')])
    const s = occurrenceStreak('habit', 'h', { type: 'daily' }, '2026-09-01', idx, '2026-10-01')
    expect(s.current).toBe(2)
    expect(idx.size).toBe(3)
  })
  it('semanas seguidas: semana atual só conta quando cumprida', () => {
    const results: Record<string, boolean> = { w0: false, w1: true, w2: true, w3: false }
    expect(weekStreak(['w0', 'w1', 'w2', 'w3'], (w) => results[w])).toBe(2)
    results.w0 = true
    expect(weekStreak(['w0', 'w1', 'w2', 'w3'], (w) => results[w])).toBe(3)
  })
})

describe('metas semanais', () => {
  const goal = (over: Partial<WeeklyGoal>): WeeklyGoal => ({ ...e, id: 'g', week: WEEK, title: 'Treinar 4 vezes', kind: 'quantity', metric: 'training.days', target: 4, manualValue: 0, status: 'active', repeatKey: 'k', ...over })
  it('"Treinar 4 vezes" mostra 2/4 automaticamente com os treinos reais', () => {
    const p = goalProgress(goal({}), weekMetrics(trainingData(), settings, WEEK, NOW))
    expect(p).toMatchObject({ value: 2, target: 4, percent: 50, achieved: false, auto: true })
  })
  it('meta manual usa o valor digitado; concluir marca como cumprida', () => {
    expect(goalProgress(goal({ kind: 'manual', metric: null, manualValue: 3, target: 5 }), null)).toMatchObject({ value: 3, percent: 60, achieved: false, auto: false })
    expect(goalProgress(goal({ kind: 'manual', metric: null, status: 'done' }), null).achieved).toBe(true)
  })
  it('sem dados financeiros, a meta de valor fica "sem dados" (não falha)', () => {
    const p = goalProgress(goal({ kind: 'money', metric: 'finance.net', target: 20000 }), weekMetrics(empty(), settings, WEEK, NOW))
    expect(p.noData).toBe(true)
  })
})

describe('desafios', () => {
  const ch = (over: Partial<Challenge>): Challenge => ({ ...e, id: 'c1', template: null, name: 'x', objective: '', mode: 'total', rule: 'training.days', target: 5, startDate: '2026-09-28', durationDays: 7, endedAt: null, ...over })
  it('desafio de treinos avança com os mesmos treinos da meta (sem registro duplicado)', () => {
    const data = trainingData()
    const before = data.completions.length
    const s = challengeState(ch({}), data, settings, NOW)
    expect(s).toMatchObject({ status: 'active', value: 2, target: 5 })
    expect(data.completions.length).toBe(before)
  })
  it('desafio diário manual ("sem gasto desnecessário") conta as marcações do dia', () => {
    const data = empty()
    data.completions = [done('challenge', 'c1', '2026-09-28'), done('challenge', 'c1', '2026-09-29')]
    const s = challengeState(ch({ mode: 'daily', rule: 'manual', target: 7 }), data, settings, NOW)
    expect(s.value).toBe(2)
    expect(s.days.filter((d) => d.counted)).toHaveLength(4)
  })
  it('situações: não iniciado, encerrado (prazo acabou), concluído e encerrado manualmente', () => {
    expect(challengeState(ch({ startDate: '2026-10-10' }), empty(), settings, NOW).status).toBe('not_started')
    expect(challengeState(ch({ startDate: '2026-09-01' }), empty(), settings, NOW).status).toBe('ended')
    expect(challengeState(ch({ target: 2 }), trainingData(), settings, NOW).status).toBe('completed')
    expect(challengeState(ch({ endedAt: 'x' }), empty(), settings, NOW).status).toBe('ended')
  })
  it('estudar dias úteis só considera seg–sex', () => {
    const t = CHALLENGE_TEMPLATES.find((x) => x.id === 'studyWeekdays')!
    const s = challengeState(ch({ mode: t.mode, rule: t.rule, target: t.target, days: t.days }), trainingData(), settings, NOW)
    expect(s.days.map((d) => d.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    expect(s.value).toBe(1)
  })
})

describe('fotos semanais', () => {
  it('a semana fecha na terça 00:00 do fuso (segunda é tolerância)', () => {
    expect(isClosable(WEEK, '2026-10-05')).toBe(false) // segunda seguinte
    expect(isClosable(WEEK, '2026-10-06')).toBe(true) // terça seguinte
  })
  it('foto guarda métricas, Score histórico e as versões das fórmulas', () => {
    const snap = buildSnapshot(trainingData(), settings, WEEK, new Date('2026-10-06T12:00:00Z'))
    expect(snap).toMatchObject({ id: WEEK, week: WEEK, metricsVersion: 3, timeZone: 'America/Sao_Paulo' })
    expect(snap.metrics['training.done']).toBe(2)
    expect(snap.scoreVersion).toBe(1)
    expect(snap.score).toHaveProperty('overall')
    expect(snap.score?.training).toBe(67) // 2 de 3 dias planejados (seg, qua, sex)
  })
  it('só fecha semanas com dados e nunca refaz uma foto existente', () => {
    const data = trainingData()
    const at = new Date('2026-10-06T12:00:00Z')
    expect(weeksToClose(data, settings, at)).toEqual([WEEK])
    data.weekSnapshots = [{ ...e, ...buildSnapshot(data, settings, WEEK, at) }]
    expect(weeksToClose(data, settings, at)).toEqual([])
  })
})

describe('treino planejado e o dia de hoje', () => {
  it('treino de hoje pendente não entra como planejado; feito entra; pulado é pausa', () => {
    const base = empty()
    base.habits = [{ ...e, id: 'tr', name: 'Treinar', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-09-28', category: 'training' }]
    // seg feito, ter pulado, qua não feito, qui (hoje) pendente
    base.completions = [done('habit', 'tr', '2026-09-28'), done('habit', 'tr', '2026-09-29', 'skipped')]
    let m = weekMetrics(base, settings, WEEK, NOW)
    expect(m.training).toEqual({ planned: 2, done: 1 }) // seg + qua
    base.completions.push(done('habit', 'tr', '2026-10-01'))
    m = weekMetrics(base, settings, WEEK, NOW)
    expect(m.training).toEqual({ planned: 3, done: 2 })
  })
})
