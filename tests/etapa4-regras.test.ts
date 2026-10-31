/**
 * Etapa 4.3 — Minhas Regras: gatilhos novos (projeto sem tarefas abertas, hábito feito, cobrança de assinatura),
 * ações que só pedem (revisão / aviso), "Pedir minha confirmação antes" com revalidação e segurança entre
 * aparelhos, regras duplicadas, frases e modelos.
 */
import { describe, expect, it } from 'vitest'
import { ruleReply } from '../src/core/assistant/ruleReply'
import { readRuleSentence } from '../src/core/assistant/ruleSentence'
import { pendingItems } from '../src/core/automation/activity'
import { confirmRuleRun, declineRuleRun, NOT_IN_SYNC } from '../src/core/rules/confirm'
import { planRulesForWrite } from '../src/core/rules/engine'
import { planScheduledRules } from '../src/core/rules/schedule'
import { findTwin } from '../src/core/rules/signature'
import { simulateRule } from '../src/core/rules/simulate'
import { TEMPLATES } from '../src/core/rules/templates'
import { TRIGGERS } from '../src/core/rules/catalog'
import { ruleProblem } from '../src/core/rules/validate'
import { applyOps } from '../src/core/rules/work'
import type { AutomationRun, Completion, DataState, Habit } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { ctx, data, goal, NOW, project, put, puts, rule, settings, T, task, TODAY, tx } from './rules-helpers'

const runs = (ops: ReturnType<typeof planRulesForWrite>) => (puts(ops, 'automationRuns') as unknown as AutomationRun[]).filter((r) => r.automation === 'rule')
const write = (d: DataState, ops: Parameters<typeof planRulesForWrite>[1]) => applyOps(d, [...ops, ...planRulesForWrite(d, ops, 'person', ctx())])

describe('gatilhos novos', () => {
  it('última tarefa aberta do projeto concluída → “todas as tarefas concluídas” (uma vez)', () => {
    const r = rule('projectTasksDone', [{ kind: 'notify', text: 'Pronto: {projeto}' }])
    const d = data({ rules: [r], projects: [project('p1')], tasks: [task('a', { projectId: 'p1', status: 'done', completedAt: `${TODAY}T08:00:00.000Z` }), task('b', { projectId: 'p1' })] })
    const ops = planRulesForWrite(d, [put('tasks', { ...d.tasks[1], status: 'done', completedAt: `${TODAY}T09:00:00.000Z` })], 'person', ctx())
    const [run] = runs(ops)
    expect(run).toMatchObject({ status: 'done', notice: { kind: 'notify', text: 'Pronto: Projeto p1' } })
    // A notice changes nothing but the run itself.
    expect(ops.every((o) => o.op === 'put' && o.collection === 'automationRuns')).toBe(true)
  })

  it('com outra tarefa ainda aberta, nada acontece', () => {
    const r = rule('projectTasksDone', [{ kind: 'notify', text: '' }])
    const d = data({ rules: [r], projects: [project('p1')], tasks: [task('a', { projectId: 'p1' }), task('b', { projectId: 'p1' })] })
    expect(runs(planRulesForWrite(d, [put('tasks', { ...d.tasks[1], status: 'done', completedAt: NOW.toISOString() })], 'person', ctx()))).toEqual([])
  })

  it('hábito de treino marcado → regra com categoria treino', () => {
    const h: Habit = { id: 'h1', createdAt: T, updatedAt: T, name: 'Academia', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-10-01', category: 'training' } as Habit
    const r = rule('habitDone', [{ kind: 'addInbox', text: 'Registrar cargas' }], [{ field: 'category', values: ['training'] }])
    const c: Completion = { id: 'habit:h1:2026-10-19', createdAt: T, updatedAt: T, source: 'habit', sourceId: 'h1', date: TODAY, status: 'done' }
    const ops = planRulesForWrite(data({ rules: [r], habits: [h] }), [put('completions', c)], 'person', ctx())
    expect(runs(ops)).toHaveLength(1)
    expect(puts(ops, 'inbox')[0]).toMatchObject({ text: 'Registrar cargas' })
    // Another category: no run.
    const other = rule('habitDone', [{ kind: 'addInbox', text: 'x' }], [{ field: 'category', values: ['reading'] }])
    expect(runs(planRulesForWrite(data({ rules: [other], habits: [h] }), [put('completions', c)], 'person', ctx()))).toEqual([])
  })

  it('cobrança de assinatura registrada → regra por data, uma vez por cobrança', () => {
    const r = rule('toolDue', [{ kind: 'createTask', title: 'Conferir {descricao}', dueDays: 0, linkProject: false, priority: 'none' }])
    const charge: AutomationRun = { id: 'auto-tool-t1-2026-10-19', createdAt: T, updatedAt: T, automation: 'toolCharge', date: TODAY, summary: 'Figma: a pagar', origin: { collection: 'tools', id: 't1', label: 'Figma' }, amount: 2000, currency: 'EUR', created: [], changed: [], status: 'pending' }
    const actx = { data: data({ rules: [r], automationRuns: [charge] }), settings, today: TODAY, convert: makeConverter({ EUR: 1 }), now: NOW }
    const ops = planScheduledRules(actx)
    expect(puts(ops, 'tasks')[0]).toMatchObject({ title: 'Conferir Figma' })
    const again = planScheduledRules({ ...actx, data: applyOps(actx.data, ops) })
    expect(again).toEqual([])
  })
})

describe('pedir revisão: só pede, nunca muda a movimentação', () => {
  it('despesa acima de R$ 500 vai para Pendências com link para a movimentação', () => {
    const r = rule('moneyOut', [{ kind: 'askReview', text: '' }], [{ field: 'amount', op: 'gt', value: 50000, currency: 'BRL' }])
    const out = tx('t1', { type: 'out', amount: 60000, currency: 'BRL', baseAmount: -10000, reason: 'Mercado' })
    const after = write(data({ rules: [r] }), [put('transactions', out)])
    expect(after.transactions[0]).toEqual(out)
    const items = pendingItems(after, TODAY)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'review', link: { path: '/finance', params: { open: 't1' } } })
    // Seen → leaves Pendências.
    const seen = { ...after, automationRuns: after.automationRuns.map((x) => ({ ...x, notice: { ...x.notice!, seenAt: NOW.toISOString() } })) }
    expect(pendingItems(seen, TODAY)).toEqual([])
  })
})

describe('pedir minha confirmação antes', () => {
  const g = goal('g1', { saved: 0 })
  const base = () => {
    const r = rule('moneyIn', [{ kind: 'createTask', title: 'Enviar recibo', dueDays: 0, linkProject: false, priority: 'none' }, { kind: 'reserveFixed', goalId: 'g1', amount: 10000 }], [], { confirm: true, id: 'rc', name: 'Recibo' })
    const income = tx('i1', { amount: 100000, baseAmount: 100000 })
    const d = write(data({ rules: [r], financeGoals: [g] }), [put('transactions', income)])
    return { r, d, run: d.automationRuns.find((x) => x.automation === 'rule')! }
  }

  it('não faz nada sozinha: só pergunta, em Pendências', () => {
    const { d, run } = base()
    expect(run.status).toBe('pending')
    expect(d.tasks).toEqual([])
    expect(d.financeGoals[0].saved).toBe(0)
    expect(pendingItems(d, TODAY).map((i) => i.kind)).toEqual(['ruleConfirm'])
  })

  it('confirmar revalida e faz; ids fixos (dois aparelhos escrevem os mesmos registros)', () => {
    const { d, run } = base()
    const a = confirmRuleRun(run, d, ctx(), true)
    const b = confirmRuleRun(run, d, ctx(), true)
    if (typeof a === 'string' || typeof b === 'string') throw new Error('não confirmou')
    expect(a.ok).toBe(true)
    expect(puts(a.ops, 'tasks').map((t) => t.id)).toEqual(puts(b.ops, 'tasks').map((t) => t.id))
    const after = applyOps(d, a.ops)
    expect(after.tasks).toHaveLength(1)
    expect(after.financeGoals[0].saved).toBe(10000)
    expect(after.automationRuns.find((x) => x.id === run.id)).toMatchObject({ status: 'done' })
    // Already answered: a second confirmation (this device or the next sync) does nothing.
    expect(confirmRuleRun(run, after, ctx(), true)).toMatch(/já foi respondido/)
  })

  it('sem sincronização em dia, bloqueia', () => {
    const { d, run } = base()
    expect(confirmRuleRun(run, d, ctx(), false)).toBe(NOT_IN_SYNC)
  })

  it('movimentação apagada ou condição que não vale mais: não faz, e registra por quê', () => {
    const { d, run } = base()
    const gone = { ...d, transactions: [] }
    const r1 = confirmRuleRun(run, gone, ctx(), true)
    if (typeof r1 === 'string') throw new Error(r1)
    expect(r1.ok).toBe(false)
    expect(applyOps(gone, r1.ops).automationRuns[0]).toMatchObject({ status: 'skipped', declined: true })

    const stricter = { ...d, rules: d.rules.map((x) => ({ ...x, conditions: [{ field: 'amount' as const, op: 'gt' as const, value: 500000, currency: 'EUR' }] })) }
    const r2 = confirmRuleRun(run, stricter, ctx(), true)
    if (typeof r2 === 'string') throw new Error(r2)
    expect(r2.ok).toBe(false)
    expect(puts(r2.ops, 'tasks')).toEqual([])
  })

  it('regra desligada ou excluída: bloqueia', () => {
    const { d, run } = base()
    expect(confirmRuleRun(run, { ...d, rules: d.rules.map((x) => ({ ...x, on: false })) }, ctx(), true)).toMatch(/desligada/)
    expect(confirmRuleRun(run, { ...d, rules: [] }, ctx(), true)).toMatch(/excluída/)
  })

  it('não fazer: fecha sem fazer nada', () => {
    const { d, run } = base()
    const ops = declineRuleRun(run, d, NOW)
    if (typeof ops === 'string') throw new Error(ops)
    const after = applyOps(d, ops)
    expect(after.automationRuns[0]).toMatchObject({ status: 'skipped', declined: true })
    expect(pendingItems(after, TODAY)).toEqual([])
  })
})

describe('regras duplicadas', () => {
  it('igual (ordem e maiúsculas não importam) → bloqueia; parecida → avisa', () => {
    const a = rule('moneyOut', [{ kind: 'askReview', text: 'Conferir' }], [{ field: 'text', contains: 'Mercado' }], { id: 'a' })
    expect(findTwin({ trigger: { kind: 'moneyOut' }, conditions: [{ field: 'text', contains: 'mercado' }], actions: [{ kind: 'askReview', text: 'conferir' }] }, [a]).same?.id).toBe('a')
    expect(findTwin({ trigger: { kind: 'moneyOut' }, conditions: [], actions: [{ kind: 'askReview', text: 'Outra' }] }, [a])).toMatchObject({ same: null, similar: { id: 'a' } })
    expect(findTwin(a, [a], 'a')).toEqual({ same: null, similar: null })
  })
})

describe('frases do pedido viram regras (sempre pela prévia)', () => {
  const rctx = { data: data({}), settings: { ...settings, currencies: ['EUR', 'BRL'] }, now: NOW, newId: () => 'novo' }
  const draftOf = (s: string) => {
    const reply = ruleReply(readRuleSentence(s)!, rctx)
    return reply.link?.params?.draft ? JSON.parse(reply.link.params.draft) : reply
  }
  it('venda → tarefa de acompanhamento', () => {
    expect(draftOf('Quando eu registrar uma venda, adicionar uma tarefa para acompanhar o pagamento')).toMatchObject({ trigger: { kind: 'saleCreated' }, actions: [{ kind: 'createTask', title: 'Acompanhar o pagamento' }] })
  })
  it('despesa acima de R$ 500 → pedir revisão (moeda escrita)', () => {
    expect(draftOf('Quando uma despesa passar de R$ 500, destacar para revisão')).toMatchObject({ trigger: { kind: 'moneyOut' }, conditions: [{ field: 'amount', op: 'gt', value: 50000, currency: 'BRL' }], actions: [{ kind: 'askReview' }] })
  })
  it('todas as tarefas do projeto → me avisar', () => {
    expect(draftOf('Quando eu concluir todas as tarefas de um projeto, me avisar')).toMatchObject({ trigger: { kind: 'projectTasksDone' }, actions: [{ kind: 'notify' }] })
  })
  it('assinatura vencer → me lembrar', () => {
    expect(draftOf('Quando uma assinatura vencer, me lembrar')).toMatchObject({ trigger: { kind: 'toolDue' }, actions: [{ kind: 'notify' }] })
  })
  it('treino → explica que o acompanhamento já é automático (não cria regra inútil)', () => {
    const r = draftOf('Quando eu registrar um treino, atualizar o acompanhamento relacionado')
    expect(r.lines.join(' ')).toMatch(/já faz sozinho/)
  })
  it('valor sem moeda: pergunta', () => {
    const r = draftOf('Quando uma despesa passar de 500, destacar para revisão')
    expect(r.choices?.map((c: { label: string }) => c.label)).toEqual(['EUR', 'BRL'])
  })
})

describe('modelos prontos', () => {
  it('cada modelo usa só gatilhos e ações que existem, e é válido depois de escolher a meta', () => {
    const kinds = new Set(TRIGGERS.map((t) => t.kind))
    for (const t of TEMPLATES) {
      const d = t.draft('EUR')
      expect(kinds.has(d.trigger.kind)).toBe(true)
      const withGoal = { ...d, name: t.name, actions: d.actions.map((a) => ('goalId' in a ? { ...a, goalId: 'g1' } : a)) }
      expect(ruleProblem(withGoal, { financeGoals: [goal('g1')] })).toBeNull()
    }
  })
  it('há modelos em todas as áreas pedidas', () => {
    expect(new Set(TEMPLATES.map((t) => t.group)).size).toBe(9)
  })
})

describe('simulação dos gatilhos novos', () => {
  it('projeto sem tarefas abertas é reconstruído pela data da última tarefa', () => {
    const d = data({ projects: [project('p1')], tasks: [task('a', { projectId: 'p1', status: 'done', completedAt: `${TODAY}T08:00:00.000Z` })] })
    const sim = simulateRule({ name: 'x', trigger: { kind: 'projectTasksDone' }, conditions: [], actions: [{ kind: 'notify', text: '' }] }, d, settings, makeConverter({ EUR: 1 }), TODAY, NOW)
    expect(sim.ranCount).toBe(1)
  })
})
