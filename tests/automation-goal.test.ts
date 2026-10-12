import { describe, expect, it } from 'vitest'
import { changeGoalMonth, goalRunId, planGoalSaves } from '../src/core/automation/goalSave'
import type { BatchOp } from '../src/core/automation/types'
import type { FinanceGoal, Transaction } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { makeCtx, T } from './automation-helpers'

const goal = (over: Partial<FinanceGoal> = {}): FinanceGoal => ({
  id: 'g1', createdAt: T, updatedAt: T, name: 'Viagem', target: 120000, saved: 0, deadline: '2027-03-31', currency: 'EUR', note: '', status: 'active', history: [],
  inBalance: true, autoSave: { day: 5, mode: 'calculated', amount: 0, since: '2026-10-01' }, ...over,
})
const money = (cents: number): Transaction => ({ id: `m${cents}`, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: T, type: 'in', amount: cents, currency: 'EUR', baseAmount: cents, reason: 'saldo' })
const puts = (ops: BatchOp[], collection: string) => ops.filter((o): o is Extract<BatchOp, { op: 'put' }> => o.op === 'put' && o.collection === collection).map((o) => o.item)
const rich = [money(1_000_000)]

describe('meta → guardar todo mês (reserva)', () => {
  it('calculado: falta ÷ meses de reserva até o prazo (out, nov, dez, jan, fev, mar = 6)', () => {
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal()], transactions: rich }, '2026-10-05'), '2026-10-01')
    expect(p.runs).toHaveLength(1)
    expect(p.runs[0]).toMatchObject({ id: goalRunId('g1', '2026-10'), automation: 'goalSave', date: '2026-10-05', amount: 20000, currency: 'EUR', status: 'done' })
    expect(p.runs[0].summary).toMatch(/^Núcleo reservou .*200,00.* para Viagem$/)
    const saved = puts(p.ops, 'financeGoals')[0] as FinanceGoal
    expect(saved.saved).toBe(20000)
    expect(saved.history.at(-1)).toEqual({ date: '2026-10-05', saved: 20000 })
  })

  it('nunca cria movimentação no Financeiro', () => {
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal()], transactions: rich }, '2026-12-06'), '2026-10-01')
    expect(puts(p.ops, 'transactions')).toEqual([])
  })

  it('valor fixo, limitado ao que falta', () => {
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal({ saved: 115000, autoSave: { day: 5, mode: 'fixed', amount: 10000, since: '2026-10-01' } })], transactions: rich }, '2026-10-05'), '2026-10-01')
    expect(p.runs[0].amount).toBe(5000)
  })

  it('recalcula sozinho depois de um mês pulado', () => {
    const skipped = { ...planGoalSaves(makeCtx({ financeGoals: [goal()], transactions: rich }, '2026-10-05'), '2026-10-01')[0].runs[0], status: 'skipped' as const }
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal()], transactions: rich, automationRuns: [skipped] }, '2026-11-05'), '2026-10-01')
    expect(p.runs.map((r) => r.date)).toEqual(['2026-11-05'])
    expect(p.runs[0].amount).toBe(24000) // 120000 ÷ 5
  })

  it('atraso: vários meses, cada um recalculado sobre o que falta', () => {
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal()], transactions: rich }, '2026-12-10'), '2026-10-01')
    expect(p.runs.map((r) => [r.date, r.amount])).toEqual([['2026-10-05', 20000], ['2026-11-05', 20000], ['2026-12-05', 20000]])
  })

  it('saldo insuficiente: reserva o que dá e registra o que faltou; o Disponível nunca fica negativo', () => {
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal({ autoSave: { day: 5, mode: 'fixed', amount: 20000, since: '2026-10-01' } })], transactions: [money(12000)] }, '2026-10-05'), '2026-10-01')
    expect(p.runs[0]).toMatchObject({ amount: 12000, status: 'done' })
    expect(p.runs[0].detail).toMatch(/^Previsto: .+ — reservado: .+ — faltaram .+ por saldo insuficiente\.$/)
    expect(p.runs[0].detail).toContain('80,00')
  })

  it('sem nada disponível: mês registrado como pulado, nada reservado', () => {
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal()], transactions: [] }, '2026-10-05'), '2026-10-01')
    expect(p.runs[0]).toMatchObject({ amount: 0, status: 'skipped' })
    expect(puts(p.ops, 'financeGoals')).toEqual([])
  })

  it('o Disponível diminui entre metas na mesma passada', () => {
    const a = goal({ id: 'a', autoSave: { day: 5, mode: 'fixed', amount: 8000, since: '2026-10-01' } })
    const b = goal({ id: 'b', autoSave: { day: 5, mode: 'fixed', amount: 8000, since: '2026-10-01' } })
    const plans = planGoalSaves(makeCtx({ financeGoals: [a, b], transactions: [money(10000)] }, '2026-10-05'), '2026-10-01')
    expect(plans.flatMap((p) => p.runs).map((r) => r.amount)).toEqual([8000, 2000])
  })

  it('reservas já existentes de outras metas contam no Disponível', () => {
    const other = goal({ id: 'x', saved: 9000, autoSave: undefined })
    const [p] = planGoalSaves(makeCtx({ financeGoals: [other, goal({ autoSave: { day: 5, mode: 'fixed', amount: 5000, since: '2026-10-01' } })], transactions: [money(10000)] }, '2026-10-05'), '2026-10-01')
    expect(p.runs[0].amount).toBe(1000)
  })

  it('para quando a meta é atingida, o prazo passa, é arquivada ou não está no saldo', () => {
    const ctx = (g: FinanceGoal, today = '2026-10-05') => planGoalSaves(makeCtx({ financeGoals: [g], transactions: rich }, today), '2026-10-01')
    expect(ctx(goal({ saved: 120000 }))).toEqual([])
    expect(ctx(goal({ deadline: '2026-10-01' }))).toEqual([])
    expect(ctx(goal({ status: 'archived' }))).toEqual([])
    expect(ctx(goal({ inBalance: false }))).toEqual([])
  })

  it('nada antes do dia em que foi ligada', () => {
    const plans = planGoalSaves(makeCtx({ financeGoals: [goal({ autoSave: { day: 5, mode: 'calculated', amount: 0, since: '2026-10-06' } })], transactions: rich }, '2026-10-20'), '2026-01-01')
    expect(plans).toEqual([])
  })

  it('dia 31 cai no último dia do mês curto', () => {
    const [p] = planGoalSaves(makeCtx({ financeGoals: [goal({ autoSave: { day: 31, mode: 'calculated', amount: 0, since: '2026-11-01' } })], transactions: rich }, '2026-11-30'), '2026-10-01')
    expect(p.runs[0].date).toBe('2026-11-30')
  })

  it('meta em outra moeda: reserva na moeda da meta; sem cotação, espera', () => {
    const brl = goal({ currency: 'BRL', target: 600000 })
    const [p] = planGoalSaves(makeCtx({ financeGoals: [brl], transactions: rich }, '2026-10-05'), '2026-10-01')
    expect(p.runs[0]).toMatchObject({ amount: 100000, currency: 'BRL' })
    const usd = goal({ currency: 'USD' })
    expect(planGoalSaves(makeCtx({ financeGoals: [usd], transactions: rich }, '2026-10-05', { convert: makeConverter({ EUR: 1 }) }), '2026-10-01')).toEqual([])
  })

  it('mudar este mês: ajusta o guardado pela diferença; não passa do Disponível', () => {
    const ctx0 = makeCtx({ financeGoals: [goal()], transactions: [money(30000)] }, '2026-10-05')
    const [p] = planGoalSaves(ctx0, '2026-10-01')
    const g = puts(p.ops, 'financeGoals')[0] as FinanceGoal
    const ctx = makeCtx({ financeGoals: [g], transactions: [money(30000)], automationRuns: p.runs }, '2026-10-06')
    const ops = changeGoalMonth(p.runs[0], 8000, ctx)
    if (typeof ops === 'string') throw new Error(ops)
    expect((puts(ops, 'financeGoals')[0] as FinanceGoal).saved).toBe(8000)
    expect(puts(ops, 'automationRuns')[0]).toMatchObject({ amount: 8000, status: 'done' })
    expect(typeof changeGoalMonth(p.runs[0], 40000, ctx)).toBe('string')
  })
})
