import { describe, expect, it } from 'vitest'
import { completionId } from '../src/core/completions'
import { weekMetrics, type RangeMetrics } from '../src/core/metrics'
import { computeScore, describeChange, SCORE_AREAS, SCORE_VERSION, scoreToRecord } from '../src/core/score'
import type { Completion, DataState, Settings, WeeklyGoal } from '../src/data/types'

const t = (expected: number, done: number) => ({ expected, done, skipped: 0 })
function metrics(over: Partial<RangeMetrics>): RangeMetrics {
  return {
    from: '2026-09-28', to: '2026-10-04', closed: true,
    items: t(0, 0), tasks: { due: t(0, 0), completed: 0 },
    habits: { ...t(0, 0), byHabit: {} }, habitsNoTraining: t(0, 0),
    routine: { ...t(0, 0), minutesDone: 0 }, routineNoTraining: t(0, 0),
    recurring: { ...t(0, 0), byItem: {} },
    training: { planned: 0, done: 0 }, study: { minutes: 0, days: 0 }, events: 0, finance: null, days: [],
    ...over,
  }
}
const goal = (manualValue: number, target: number): WeeklyGoal => ({ id: `g${manualValue}${target}`, createdAt: '', updatedAt: '', week: '2026-09-28', title: 'x', kind: 'manual', metric: null, target, manualValue, status: 'active', repeatKey: 'k' })

describe('NÚCLEO Score v1', () => {
  it('pesos aprovados somam 100', () => {
    expect(SCORE_AREAS.map((a) => [a.id, a.weight])).toEqual([['productivity', 25], ['habits', 20], ['routine', 15], ['training', 15], ['organization', 10], ['goals', 15]])
    expect(SCORE_VERSION).toBe(1)
  })

  it('exemplo apresentado: rotina com dados insuficientes fica fora e o resultado é 81', () => {
    const m = metrics({ tasks: { due: t(10, 8), completed: 8 }, habitsNoTraining: t(21, 18), routineNoTraining: t(2, 2), training: { planned: 4, done: 3 }, recurring: { ...t(5, 4), byItem: {} } })
    const r = computeScore(m, [goal(1, 2), goal(2, 2), goal(3, 3)])
    expect(r.areas.routine.score).toBeNull()
    expect([r.areas.productivity.score, r.areas.habits.score, r.areas.training.score, r.areas.organization.score, r.areas.goals.score]).toEqual([80, 86, 75, 80, 83])
    expect(r.overall).toBe(81)
  })

  it('área sem dados não vira zero; com menos de 2 áreas válidas não há Score geral', () => {
    const r = computeScore(metrics({ tasks: { due: t(5, 5), completed: 5 } }), [])
    expect(r.areas.productivity.score).toBe(100)
    expect(r.validAreas).toBe(1)
    expect(r.overall).toBeNull()
    expect(scoreToRecord(r).habits).toBeNull()
  })

  it('treino não é contado duas vezes: hábito de treino e bloco de treino ficam só na área Treino', () => {
    const e = { createdAt: '', updatedAt: '' }
    const d: DataState = { transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], weeklyGoals: [], challenges: [], weekCheckins: [], weekSnapshots: [] }
    d.habits = [
      { ...e, id: 'treino', name: 'Treinar', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-09-28', category: 'training' },
      { ...e, id: 'ler', name: 'Ler', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-09-28', category: 'reading' },
    ]
    d.routinePlans = [{ ...e, createdAt: '2026-09-27T12:00:00Z', id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks: [{ id: 'gym', day: 1, start: '07:00', end: '08:00', title: 'Musculação', kind: 'training', fixed: true }, { id: 'w', day: 1, start: '09:00', end: '12:00', title: 'Trabalho', kind: 'work', fixed: true }] }]
    const c = (source: Completion['source'], id: string, date: string): Completion => ({ ...e, id: completionId(source, id, date), source, sourceId: id, date, status: 'done' })
    d.completions = [c('habit', 'treino', '2026-09-28'), c('routine', 'gym', '2026-09-28'), c('habit', 'ler', '2026-09-28')]
    const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { habits: true, routine: true } } as Settings
    const m = weekMetrics(d, settings, '2026-09-28', new Date('2026-09-29T20:00:00Z')) // terça: segunda já passou
    expect(m.training.done).toBe(1) // um dia, mesmo com hábito + rotina
    expect(m.habitsNoTraining).toMatchObject({ expected: 1, done: 1 }) // só "Ler"
    expect(m.routineNoTraining).toMatchObject({ expected: 1, done: 0 }) // só "Trabalho"
    expect(m.habits.expected).toBe(2) // o resumo ainda mostra todos os hábitos
  })

  it('treino feito acima do planejado fica limitado a 100', () => {
    expect(computeScore(metrics({ training: { planned: 2, done: 5 } }), []).areas.training.score).toBe(100)
  })

  it('comparação só consigo mesmo, com texto neutro', () => {
    expect(describeChange(81, 75)).toBe('+6 em relação à semana passada')
    expect(describeChange(80, 81)).toBe('parecido com a semana passada')
    expect(describeChange(null, 70)).toBeNull()
  })
})
