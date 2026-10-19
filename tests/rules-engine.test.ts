import { describe, expect, it } from 'vitest'
import { conditionHolds, matches } from '../src/core/rules/conditions'
import { detectEvents } from '../src/core/rules/events'
import { assertNoInventedFacts, planRulesForWrite, ruleRunId, safeRulesForWrite } from '../src/core/rules/engine'
import { fillTokens } from '../src/core/rules/text'
import { formatMoney } from '../src/lib/money'
import type { AutomationRun, FinanceGoal, Rule } from '../src/data/types'
import { client, ctx, data, goal, NOW, project, put, puts, rule, sale, settings, task, TODAY, tx } from './rules-helpers'

const runsOf = (ops: ReturnType<typeof planRulesForWrite>) => puts(ops, 'automationRuns') as unknown as AutomationRun[]
const reserve20 = (goalId = 'g1') => ({ kind: 'reservePercent' as const, goalId, percent: 20 })
const newTask = (title = 'Enviar recibo a {cliente}', dueDays: number | null = null) => ({ kind: 'createTask' as const, title, dueDays, linkProject: true, priority: 'none' as const })

/** A project payment of `amount` cents in `currency`, as saveProject writes it (income with source). */
function projectPayment(amount: number, currency = 'EUR', date = `${TODAY}T09:00:00.000Z`) {
  return tx('rcv-project-pay1', { amount, currency, baseAmount: currency === 'EUR' ? amount : Math.round(amount / 6), reason: 'Site · Pagamento de projeto', category: 'freelance', createdAt: date, source: { kind: 'project', parentId: 'p1', paymentId: 'pay1' } })
}

describe('condições', () => {
  const ev = detectEvents(data({ projects: [project('p1')], clients: [client()] }), [put('transactions', projectPayment(80000, 'BRL'))], ctx())[0]

  it('valor com moeda: “maior que €500” nunca combina com R$ 800', () => {
    expect(conditionHolds({ field: 'amount', op: 'gt', value: 50000, currency: 'EUR' }, ev)).toBe(false)
    expect(conditionHolds({ field: 'amount', op: 'gt', value: 50000, currency: 'BRL' }, ev)).toBe(true)
  })

  it('entre (em qualquer ordem), menor que', () => {
    expect(conditionHolds({ field: 'amount', op: 'between', value: 90000, value2: 70000, currency: 'BRL' }, ev)).toBe(true)
    expect(conditionHolds({ field: 'amount', op: 'lt', value: 80000, currency: 'BRL' }, ev)).toBe(false)
  })

  it('vários valores numa condição = qualquer um deles (OU); condições juntas = todas (E)', () => {
    expect(conditionHolds({ field: 'category', values: ['sales', 'freelance'] }, ev)).toBe(true)
    const r = rule('moneyIn', [], [{ field: 'category', values: ['freelance'] }, { field: 'amount', op: 'gt', value: 50000, currency: 'EUR' }])
    expect(matches(r, ev)).toBe(false)
  })

  it('texto contém ignora acento e maiúscula; origem, cliente, projeto, dia da semana', () => {
    expect(conditionHolds({ field: 'text', contains: 'PAGAMENTO de projeto' }, ev)).toBe(true)
    expect(conditionHolds({ field: 'origin', values: ['project'] }, ev)).toBe(true)
    expect(conditionHolds({ field: 'client', values: ['c1'] }, ev)).toBe(true)
    expect(conditionHolds({ field: 'project', values: ['p2'] }, ev)).toBe(false)
    expect(conditionHolds({ field: 'weekday', values: [1] }, ev)).toBe(true) // 2026-10-19 é segunda
  })

  it('atalhos de gatilho: pagamento de projeto só com origem projeto', () => {
    expect(matches(rule('projectPayment', []), ev)).toBe(true)
    expect(matches(rule('salePayment', []), ev)).toBe(false)
    expect(matches(rule('moneyOut', []), ev)).toBe(false)
  })

  it('marcadores: preenchidos, ou uma palavra neutra (nunca vazio)', () => {
    expect(fillTokens('Enviar recibo a {cliente} ({valor})', ev.names)).toBe(`Enviar recibo a Ana (${formatMoney(80000, 'BRL')})`)
    expect(fillTokens('Ligar para {cliente}', {})).toBe('Ligar para cliente')
  })
})

describe('eventos de uma gravação', () => {
  const before = data({ projects: [project('p1')], clients: [client()], tasks: [task('t1')], financeGoals: [goal('g1', { saved: 900000 })], transactions: [tx('old')] })
  const kinds = (ops: Parameters<typeof detectEvents>[1]) => detectEvents(before, ops, ctx()).map((e) => e.kind)

  it('criar vs atualizar', () => {
    expect(kinds([put('transactions', tx('new'))])).toEqual(['moneyIn'])
    expect(kinds([put('transactions', { ...tx('old'), reason: 'editada' })])).toEqual([])
    expect(kinds([put('transactions', tx('adj', { type: 'adjust' }))])).toEqual([])
    expect(kinds([put('sales', sale('s1'))])).toEqual(['saleCreated'])
    expect(kinds([put('clients', client('c2'))])).toEqual(['clientCreated'])
    expect(kinds([put('projects', project('p2'))])).toEqual(['projectCreated'])
  })

  it('status: de → para; tarefa concluída; tarefa da rotina não conta', () => {
    const ev = detectEvents(before, [put('projects', { ...project('p1'), status: 'done' })], ctx())[0]
    expect(ev).toMatchObject({ kind: 'projectStatus', status: 'done', statusBefore: 'inProgress', clientId: 'c1' })
    expect(matches(rule('projectDone', []), ev)).toBe(true)
    expect(kinds([put('tasks', { ...task('t1'), status: 'done', completedAt: NOW.toISOString() })])).toEqual(['taskDone'])
    expect(kinds([put('tasks', task('t9', { fromRoutine: { blockId: 'b', date: TODAY } }))])).toEqual([])
    expect(kinds([put('clients', { ...client(), status: 'done' })])).toEqual(['clientStatus'])
  })

  it('meta: recebeu reserva e atingiu (uma vez por alvo)', () => {
    const evs = detectEvents(before, [put('financeGoals', { ...goal('g1'), saved: 1000000 })], ctx())
    expect(evs.map((e) => e.kind)).toEqual(['goalSaved', 'goalReached'])
    expect(evs[1].key).toBe('greach:g1:1000000')
    expect(kinds([put('financeGoals', { ...goal('g1'), saved: 100 })])).toEqual([])
  })
})

describe('motor: execução na gravação', () => {
  const base = (rules: Rule[], over = {}) => data({ rules, projects: [project('p1')], clients: [client()], financeGoals: [goal('g1', { name: 'Impostos' }), goal('g2', { name: 'Viagem' })], ...over })

  it('pagamento de projeto → reservar 20% + criar tarefa, numa execução com id fixo', () => {
    const r = rule('projectPayment', [reserve20(), newTask()], [], { id: 'imp', name: 'Separe para impostos' })
    const ops = planRulesForWrite(base([r]), [put('transactions', projectPayment(120000))], 'person', ctx())
    const [run] = runsOf(ops)
    expect(run.id).toBe(ruleRunId('imp', 'tx:rcv-project-pay1'))
    expect(run.id.length).toBeLessThanOrEqual(100)
    expect(run.summary).toBe(`Regra “Separe para impostos”: reservou ${formatMoney(24000, 'EUR')} para Impostos (20% de ${formatMoney(120000, 'EUR')}) · criou a tarefa “Enviar recibo a Ana”`)
    expect(run).toMatchObject({ automation: 'rule', status: 'done', rule: { id: 'imp' }, cause: { txId: 'rcv-project-pay1' } })
    const g = puts(ops, 'financeGoals')[0] as unknown as FinanceGoal
    expect(g.saved).toBe(24000)
    expect(run.changed).toEqual([{ collection: 'financeGoals', id: 'g1', field: 'saved', before: 0, after: 24000, delta: 24000, action: 0 }])
    const t = puts(ops, 'tasks')[0]
    expect(t).toMatchObject({ id: `${run.id}-1`, title: 'Enviar recibo a Ana', projectId: 'p1', status: 'todo' })
    expect(run.created).toEqual([{ collection: 'tasks', id: `${run.id}-1`, fp: expect.any(String), action: 1 }])
    // Nunca cria dinheiro: nenhuma movimentação nas ops da regra.
    expect(puts(ops, 'transactions')).toHaveLength(0)
  })

  it('a mesma execução nunca roda de novo', () => {
    const r = rule('projectPayment', [reserve20()], [], { id: 'imp' })
    const first = planRulesForWrite(base([r]), [put('transactions', projectPayment(120000))], 'person', ctx())
    const again = planRulesForWrite(base([r], { automationRuns: runsOf(first) }), [put('transactions', projectPayment(120000))], 'person', ctx())
    expect(again).toEqual([])
  })

  it('o que regra ou desfazer grava não gera evento (sem loops)', () => {
    const r = rule('taskCreated', [newTask('Outra')])
    expect(planRulesForWrite(base([r]), [put('tasks', task('t2'))], 'rule', ctx())).toEqual([])
    expect(planRulesForWrite(base([r]), [put('tasks', task('t2'))], 'undo', ctx())).toEqual([])
    // "tarefa criada → criar tarefa": uma tarefa só.
    expect(puts(planRulesForWrite(base([r]), [put('tasks', task('t2'))], 'person', ctx()), 'tasks')).toHaveLength(1)
  })

  it('a automação da Parte 1 gera eventos (assinante pago → dinheiro entrou)', () => {
    const r = rule('subscriberPaid', [reserve20()])
    const income = tx('rcv-subscriber-x', { source: { kind: 'subscriber', parentId: 's1', paymentId: 'x' } })
    expect(runsOf(planRulesForWrite(base([r]), [put('transactions', income)], 'automation', ctx()))).toHaveLength(1)
  })

  it('moeda: regra de €500 não dispara com R$ 800', () => {
    const r = rule('projectPayment', [reserve20()], [{ field: 'amount', op: 'gt', value: 50000, currency: 'EUR' }])
    expect(planRulesForWrite(base([r]), [put('transactions', projectPayment(80000, 'BRL'))], 'person', ctx())).toEqual([])
  })

  it('percentual em outra moeda: converte pela cotação; sem cotação, a ação não é feita e as outras seguem', () => {
    const r = rule('projectPayment', [reserve20(), newTask('Recibo')])
    const brl = planRulesForWrite(base([r]), [put('transactions', projectPayment(60000, 'BRL'))], 'person', ctx())
    expect((puts(brl, 'financeGoals')[0] as unknown as FinanceGoal).saved).toBe(2000) // 20% de R$600 = R$120 = €20
    const noRate = planRulesForWrite(base([r]), [put('transactions', projectPayment(60000, 'USD'))], 'person', ctx())
    const [run] = runsOf(noRate)
    expect(run.status).toBe('done')
    expect(run.actions).toMatchObject([{ ok: false, code: 'noRate', text: 'Reservar para Impostos: sem cotação para converter USD em EUR' }, { ok: true, text: 'criou a tarefa “Recibo”' }])
    expect(run.detail).toBe('Não fez: Reservar para Impostos: sem cotação para converter USD em EUR')
  })

  it('reserva limitada ao que falta e ao Disponível; meta fora do saldo ou arquivada não reserva', () => {
    const r = rule('projectPayment', [reserve20()])
    const nearly = base([r], { financeGoals: [goal('g1', { name: 'Impostos', target: 10000, saved: 9000 })] })
    expect((puts(planRulesForWrite(nearly, [put('transactions', projectPayment(120000))], 'person', ctx()), 'financeGoals')[0] as unknown as FinanceGoal).saved).toBe(10000)
    const archived = base([r], { financeGoals: [goal('g1', { status: 'archived' })] })
    expect(runsOf(planRulesForWrite(archived, [put('transactions', projectPayment(120000))], 'person', ctx()))[0].status).toBe('skipped')
    const outside = base([r], { financeGoals: [goal('g1', { inBalance: false })] })
    expect(runsOf(planRulesForWrite(outside, [put('transactions', projectPayment(120000))], 'person', ctx()))[0].actions![0].ok).toBe(false)
  })

  it('ordem: a regra de cima reserva primeiro do mesmo Disponível', () => {
    const a = rule('moneyIn', [{ kind: 'reserveFixed', goalId: 'g1', amount: 70000 }], [], { order: 0 })
    const b = rule('moneyIn', [{ kind: 'reserveFixed', goalId: 'g2', amount: 70000 }], [], { order: 1 })
    const ops = planRulesForWrite(base([b, a]), [put('transactions', tx('n1', { amount: 100000, baseAmount: 100000 }))], 'person', ctx())
    const goals = puts(ops, 'financeGoals') as unknown as FinanceGoal[]
    expect(goals.find((g) => g.id === 'g1')!.saved).toBe(70000)
    expect(goals.find((g) => g.id === 'g2')!.saved).toBe(30000)
  })

  it('pagamento com data anterior ao dia em que a regra foi ligada não dispara', () => {
    const r = rule('projectPayment', [reserve20()], [], { since: TODAY })
    expect(planRulesForWrite(base([r]), [put('transactions', projectPayment(120000, 'EUR', '2026-10-10T12:00:00.000Z'))], 'automation', ctx())).toEqual([])
  })

  it('regra desligada ou pausada não roda', () => {
    expect(planRulesForWrite(base([rule('moneyIn', [newTask()], [], { on: false })]), [put('transactions', tx('n'))], 'person', ctx())).toEqual([])
    expect(planRulesForWrite(base([rule('moneyIn', [newTask()], [], { paused: { at: '', reason: 'x' } })]), [put('transactions', tx('n'))], 'person', ctx())).toEqual([])
  })

  it('categoria: só quando a movimentação não tem; status do projeto segue para o cliente (Parte 1)', () => {
    const cat = rule('moneyIn', [{ kind: 'setCategory', category: 'salary' }])
    const ops = planRulesForWrite(base([cat]), [put('transactions', tx('n'))], 'person', ctx())
    expect(puts(ops, 'transactions')[0]).toMatchObject({ id: 'n', category: 'salary' })
    expect(runsOf(planRulesForWrite(base([cat]), [put('transactions', tx('n', { category: 'freelance' }))], 'person', ctx()))[0].status).toBe('skipped')

    const close = rule('taskDone', [{ kind: 'projectStatus', status: 'done' }])
    const t = task('t1', { projectId: 'p1' })
    const res = planRulesForWrite(base([close], { tasks: [t] }), [put('tasks', { ...t, status: 'done', completedAt: NOW.toISOString() })], 'person', ctx())
    expect(puts(res, 'projects')[0]).toMatchObject({ status: 'done', endDate: TODAY })
    expect(puts(res, 'clients')[0]).toMatchObject({ status: 'done' })
    expect(runsOf(res).map((r) => r.automation).sort()).toEqual(['projectClient', 'rule'])
  })

  it('limite de segurança: na 31ª execução do dia a regra é pausada', () => {
    const r = rule('taskCreated', [{ kind: 'addInbox', text: 'x' }], [], { id: 'busy' })
    const old = Array.from({ length: 30 }, (_, i) => ({ id: `rule-busy-${i}`, automation: 'rule', date: TODAY, rule: { id: 'busy', name: 'x' } }) as unknown as AutomationRun)
    const ops = planRulesForWrite(base([r], { automationRuns: old }), [put('tasks', task('t5'))], 'person', ctx())
    expect(puts(ops, 'rules')[0]).toMatchObject({ id: 'busy', on: false, paused: { reason: 'Rodou 30 vezes hoje' } })
    expect(puts(ops, 'inbox')).toHaveLength(0)
  })

  it('guarda: regra nunca cria nem altera movimentação além da categoria', () => {
    const d = data({ transactions: [tx('a')] })
    expect(() => assertNoInventedFacts(d, [put('transactions', tx('b'))])).toThrow()
    expect(() => assertNoInventedFacts(d, [put('transactions', { ...tx('a'), amount: 1 })])).toThrow()
    expect(() => assertNoInventedFacts(d, [{ op: 'remove', collection: 'tasks', id: 'x' }])).toThrow()
    expect(() => assertNoInventedFacts(d, [put('transactions', { ...tx('a'), category: 'salary', updatedAt: 'z' })])).not.toThrow()
  })
})

describe('falha do motor nunca bloqueia a gravação', () => {
  it('regra corrompida: a gravação segue e o erro fica registrado (um por dia)', () => {
    const broken = { ...rule('moneyIn', []), actions: null } as unknown as Rule
    const ops = safeRulesForWrite(data({ rules: [broken] }), settings, ctx().convert, [put('transactions', tx('n'))], 'person', NOW)
    expect(ops).toHaveLength(1)
    expect(runsOf(ops)[0]).toMatchObject({ id: `rule-error-${TODAY}`, status: 'skipped', summary: 'As regras não conseguiram rodar nesta ação' })
  })

  it('sem regras, nada é calculado', () => {
    expect(safeRulesForWrite(data(), settings, ctx().convert, [put('transactions', tx('n'))], 'person', NOW)).toEqual([])
  })
})
