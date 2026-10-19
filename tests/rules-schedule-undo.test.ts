import { describe, expect, it } from 'vitest'
import { linkedRuleRuns, undoRun } from '../src/core/automation/undo'
import { planRulesForWrite } from '../src/core/rules/engine'
import { occurrences, planScheduledRules } from '../src/core/rules/schedule'
import { applyOps } from '../src/core/rules/work'
import type { AutomationRun, DataState, FinanceGoal, Rule } from '../src/data/types'
import { makeCtx } from './automation-helpers'
import { client, ctx, data, goal, project, put, puts, rule, settings, task, TODAY, tx } from './rules-helpers'

const runs = (ops: ReturnType<typeof planScheduledRules>) => puts(ops, 'automationRuns') as unknown as AutomationRun[]
const sched = (d: Partial<DataState>, today = TODAY) => planScheduledRules({ ...makeCtx(d, today), settings })
const inbox = (text = 'Revisar o mês') => ({ kind: 'addInbox' as const, text })

describe('regras por data', () => {
  it('dia 31 cai no último dia dos meses curtos', () => {
    expect(occurrences({ trigger: { kind: 'monthDay', day: 31 } }, '2027-01-15', '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
    expect(occurrences({ trigger: { kind: 'weekDay', weekdays: [1, 5] } }, '2026-10-19', '2026-10-25')).toEqual(['2026-10-19', '2026-10-23'])
  })

  it('no dia: roda uma vez (id fixo); de novo no mesmo dia, nada', () => {
    const r = rule({ kind: 'monthDay', day: 19 }, [inbox()], [], { since: '2026-10-01' })
    const ops = sched({ rules: [r] })
    expect(puts(ops, 'inbox')).toHaveLength(1)
    expect(runs(ops)[0]).toMatchObject({ status: 'done', date: TODAY })
    expect(sched({ rules: [r], automationRuns: runs(ops) })).toEqual([])
  })

  it('app fechado várias semanas: só a mais recente roda; as anteriores “não rodou” (máx. 5, desde que ligada)', () => {
    const r = rule({ kind: 'weekDay', weekdays: [1] }, [inbox('Revisar a semana')], [], { since: '2026-09-01' })
    const ops = sched({ rules: [r] })
    expect(puts(ops, 'inbox')).toHaveLength(1)
    const list = runs(ops)
    expect(list.filter((x) => x.status === 'skipped').map((x) => x.date)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'])
    expect(list.filter((x) => x.status === 'skipped')[0].summary).toBe(`Regra “${r.name}” não rodou em 21/09`)
    // Ligada hoje: nada antes de hoje.
    expect(runs(sched({ rules: [{ ...r, since: TODAY }] })).map((x) => x.status)).toEqual(['done'])
  })

  it('regra por data nunca reserva dinheiro', () => {
    const r = rule({ kind: 'monthDay', day: 19 }, [{ kind: 'reserveFixed', goalId: 'g1', amount: 100 }, inbox()])
    const ops = sched({ rules: [r], financeGoals: [goal('g1')], transactions: [tx('a')] })
    expect(puts(ops, 'financeGoals')).toHaveLength(0)
    expect(puts(ops, 'inbox')).toHaveLength(1)
  })

  it('tarefa atrasou: uma vez por prazo, só se atrasou com a regra ligada, com condições', () => {
    const r = rule('taskOverdue', [inbox('Reagendar: {tarefa}')], [{ field: 'priority', values: ['high'] }], { since: '2026-10-15' })
    const tasks = [
      task('late', { title: 'Mandar proposta', dueDate: '2026-10-17', priority: 'high' }),
      task('old', { dueDate: '2026-09-01', priority: 'high' }),
      task('low', { dueDate: '2026-10-17', priority: 'low' }),
      task('done', { dueDate: '2026-10-17', priority: 'high', status: 'done' }),
      task('today', { dueDate: TODAY, priority: 'high' }),
    ]
    const ops = sched({ rules: [r], tasks })
    expect(puts(ops, 'inbox').map((i) => i.text)).toEqual(['Reagendar: Mandar proposta'])
    expect(sched({ rules: [r], tasks, automationRuns: runs(ops) })).toEqual([])
    // Prazo mudou e atrasou de novo: conta outra vez.
    const moved = tasks.map((t) => (t.id === 'late' ? { ...t, dueDate: '2026-10-18' } : t))
    expect(puts(sched({ rules: [r], tasks: moved, automationRuns: runs(ops) }), 'inbox')).toHaveLength(1)
  })
})

describe('desfazer o que a regra fez', () => {
  const r: Rule = rule('projectPayment', [{ kind: 'reservePercent', goalId: 'g1', percent: 20 }, { kind: 'createTask', title: 'Recibo {cliente}', dueDays: 3, linkProject: true, priority: 'none' }, { kind: 'setCategory', category: 'salary' }], [], { id: 'imp' })
  const income = tx('rcv-project-p', { amount: 100000, baseAmount: 100000, source: { kind: 'project', parentId: 'p1', paymentId: 'p' } })
  const before = data({ rules: [r], projects: [project('p1')], clients: [client()], financeGoals: [goal('g1')] })
  const own = [put('transactions', income)]
  const extra = planRulesForWrite(before, own, 'person', ctx())
  const after = applyOps(before, [...own, ...extra])
  const run = (puts(extra, 'automationRuns') as unknown as AutomationRun[])[0]

  it('desfaz tudo da execução: reserva, tarefa intacta, categoria', () => {
    const { ops, partial } = undoRun(run, after, TODAY)
    const done = applyOps(after, ops)
    expect(partial).toBe(false)
    expect(done.financeGoals[0].saved).toBe(0)
    expect(done.tasks).toHaveLength(0)
    expect(done.transactions[0].category).toBeUndefined()
    expect('category' in done.transactions[0]).toBe(false)
    expect(done.automationRuns.find((x) => x.id === run.id)!.status).toBe('undone')
    // A movimentação (fato real) fica.
    expect(done.transactions).toHaveLength(1)
  })

  it('preserva o que a pessoa mudou depois: tarefa editada fica; dinheiro guardado à mão fica; categoria trocada fica', () => {
    const edited = {
      ...after,
      tasks: after.tasks.map((t) => ({ ...t, status: 'done' as const, completedAt: 'x' })),
      financeGoals: after.financeGoals.map((g) => ({ ...g, saved: g.saved + 5000 })),
      transactions: after.transactions.map((t) => ({ ...t, category: 'freelance' })),
    }
    const { ops, partial } = undoRun(run, edited, TODAY)
    const done = applyOps(edited, ops)
    expect(partial).toBe(true)
    expect(done.tasks).toHaveLength(1)
    expect((done.financeGoals[0] as FinanceGoal).saved).toBe(5000)
    expect(done.transactions[0].category).toBe('freelance')
  })

  it('cascata: desfazer a cobrança que trouxe o dinheiro encontra a execução da regra', () => {
    const parte1 = { id: 'auto-sub-x', automation: 'subscriberCharge', status: 'done', created: [{ collection: 'transactions', id: 'rcv-project-p' }] } as unknown as AutomationRun
    expect(linkedRuleRuns(parte1, [run, parte1]).map((x) => x.id)).toEqual([run.id])
    expect(linkedRuleRuns(parte1, [{ ...run, status: 'undone' }])).toEqual([])
  })
})
