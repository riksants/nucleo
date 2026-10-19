import { describe, expect, it } from 'vitest'
import { applyProposal } from '../src/core/assistant/proposal'
import { ruleReply } from '../src/core/assistant/ruleReply'
import { readRuleSentence } from '../src/core/assistant/ruleSentence'
import { undoAction, undoRun } from '../src/core/automation/undo'
import { ruleRecord } from '../src/core/rules/build'
import { MAX_CHAIN_DEPTH, planRulesForWrite } from '../src/core/rules/engine'
import { planRetry } from '../src/core/rules/retry'
import { NO_HISTORY, simulateRule } from '../src/core/rules/simulate'
import { applyOps } from '../src/core/rules/work'
import type { AutomationRun, DataState, Entity, FinanceGoal, Rule } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { client, ctx, data, goal, NOW, project, put, puts, rule, settings, task, TODAY, tx } from './rules-helpers'

const runsOf = (ops: ReturnType<typeof planRulesForWrite>) => puts(ops, 'automationRuns') as unknown as AutomationRun[]
const ruleRuns = (ops: ReturnType<typeof planRulesForWrite>) => runsOf(ops).filter((r) => r.automation === 'rule')
let ids = 0
const newId = () => `id${++ids}`
const replyCtx = (d: DataState) => ({ data: d, settings, now: NOW, newId })
const income = (amount: number, currency = 'EUR', id = 'in1') => tx(id, { amount, currency, baseAmount: currency === 'EUR' ? amount : Math.round(amount / 6) })
const projectIncome = (amount: number) => tx('rcv-project-p', { amount, baseAmount: amount, source: { kind: 'project', parentId: 'p1', paymentId: 'p' } })
const write = (d: DataState, ops: Parameters<typeof planRulesForWrite>[1]) => {
  const extra = planRulesForWrite(d, ops, 'person', ctx())
  return { extra, after: applyOps(d, [...ops, ...extra]) }
}

// ------------------------------------------------------------------ Assistente
describe('Assistente criando regras', () => {
  const d = data({ financeGoals: [goal('imp', { name: 'Impostos' }), goal('via', { name: 'Viagem' })], projects: [project('p1')], clients: [client()] })

  it('frase simples → prévia completa, nada gravado antes de confirmar', () => {
    const before = structuredClone(d)
    const r = ruleReply(readRuleSentence('Sempre que eu receber de um projeto, guarda 20% para impostos.')!, replyCtx(d))
    expect(r.lines[0]).toBe('Entendi. Vou criar esta regra:')
    expect(r.rule).toEqual({ when: 'eu receber pagamento de um projeto', ifs: [], dos: ['reservar 20% para Impostos'] })
    expect(r.proposal?.confirmLabel).toBe('Confirmar e criar regra')
    expect(d).toEqual(before)
  })

  it('frase com condição e moeda; tarefa com prazo relativo', () => {
    const r = ruleReply(readRuleSentence('Quando entrar mais de €1.000, guarda 10% para minha meta Viagem.')!, replyCtx(d))
    expect(r.rule).toEqual({ when: 'entrar dinheiro', ifs: [expect.stringContaining('maior que')], dos: ['reservar 10% para Viagem'] })
    const t = ruleReply(readRuleSentence('Quando eu concluir um projeto, cria uma tarefa para pedir avaliação daqui 3 dias.')!, replyCtx(d))
    expect(t.rule?.dos).toEqual(['criar a tarefa “Pedir avaliação” para daqui 3 dias'])
  })

  it('ambígua (meta não dita, várias metas): pergunta, com uma opção por meta; a escolha continua a mesma regra', () => {
    const r = ruleReply(readRuleSentence('Guarda 20% quando eu receber dinheiro.')!, replyCtx(d))
    expect(r.lines[0]).toBe('Para qual meta você quer reservar os 20%?')
    expect(r.proposal).toBeUndefined()
    expect(r.choices?.map((c) => c.label)).toEqual(['Impostos', 'Viagem'])
    const next = ruleReply(r.choices![1].sketch, replyCtx(d))
    expect(next.rule?.dos).toEqual(['reservar 20% para Viagem'])
  })

  it('meta inexistente: diz e pergunta (não adivinha); valor sem moeda: pergunta a moeda', () => {
    const r = ruleReply(readRuleSentence('Sempre que eu receber de um projeto, guarda 20% para Casa')!, replyCtx(d))
    expect(r.lines[0]).toBe('Não encontrei a meta “Casa”. Para qual meta você quer reservar os 20%?')
    expect(r.proposal).toBeUndefined()
    const m = ruleReply(readRuleSentence('Quando entrar mais de 1000, guarda 10% para Viagem')!, replyCtx(d))
    expect(m.lines[0]).toContain('Em qual moeda')
    expect(m.proposal).toBeUndefined()
  })

  it('frase que não é regra continua com o Assistente de sempre', () => {
    expect(readRuleSentence('Quero guardar R$ 5.000 até dezembro')).toBeNull()
    expect(readRuleSentence('O que tenho hoje?')).toBeNull()
  })

  it('confirmar grava a MESMA regra que o editor gravaria (mesma estrutura, ligada desde hoje)', async () => {
    const r = ruleReply(readRuleSentence('Sempre que eu receber de um projeto, guarda 20% para impostos')!, replyCtx(d))
    const saved: Entity[] = []
    await applyProposal(r.proposal!, new Set(['rule']), { save: async (_c, rec) => (saved.push(rec), rec), remove: async () => {}, current: () => undefined })
    const fromAssistant = saved[0] as unknown as Rule
    const fromEditor = ruleRecord({ name: fromAssistant.name, trigger: { kind: 'projectPayment' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: 'imp', percent: 20 }] }, true, undefined, d.rules, TODAY, () => fromAssistant.id)
    expect(fromAssistant).toEqual(fromEditor)
    expect(fromAssistant).toMatchObject({ on: true, since: TODAY })
    expect('chain' in fromAssistant).toBe(false)
  })
})

// ------------------------------------------------------------------ Simulação
describe('simulação (somente leitura)', () => {
  const base = () =>
    data({
      financeGoals: [goal('imp', { name: 'Impostos' })],
      transactions: [income(100000, 'EUR', 'a'), income(40000, 'EUR', 'b'), income(600000, 'BRL', 'c'), tx('old', { createdAt: '2026-08-01T10:00:00.000Z' })],
      tasks: [task('t1', { status: 'done', completedAt: `${TODAY}T08:00:00.000Z` })],
    })

  it('não altera nenhum dado', () => {
    const d = base()
    const before = structuredClone(d)
    simulateRule({ name: 'x', trigger: { kind: 'moneyIn' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: 'imp', percent: 10 }, { kind: 'createTask', title: 'Recibo', dueDays: 0, linkProject: false, priority: 'none' }] }, d, settings, ctx().convert, TODAY, NOW)
    expect(d).toEqual(before)
  })

  it('resultados, condições, moedas e várias ações; reservas marcadas como estimativa', () => {
    const sim = simulateRule({ name: 'x', trigger: { kind: 'moneyIn' }, conditions: [{ field: 'amount', op: 'gt', value: 50000, currency: 'EUR' }], actions: [{ kind: 'reservePercent', goalId: 'imp', percent: 10 }, { kind: 'createTask', title: 'Recibo', dueDays: 0, linkProject: false, priority: 'none' }] }, base(), settings, ctx().convert, TODAY, NOW)
    expect(sim.items).toHaveLength(3) // 'old' fica fora dos 30 dias
    expect(sim.ranCount).toBe(1) // só €1.000 passa; R$6.000 não é comparado sem conversão
    const ran = sim.items.find((x) => x.ran)!
    expect(ran.actions.map((a) => [a.ok, a.estimated])).toEqual([[true, true], [true, false]])
    expect(sim.notes.join(' ')).toContain('estimativas')
    const conv = simulateRule({ name: 'x', trigger: { kind: 'moneyIn' }, conditions: [{ field: 'amount', op: 'gt', value: 50000, currency: 'EUR', compare: 'base' }], actions: [{ kind: 'addInbox', text: 'x' }] }, base(), settings, ctx().convert, TODAY, NOW)
    expect(conv.ranCount).toBe(2) // R$6.000 ≈ €1.000 entra com a conversão
  })

  it('gatilho sem histórico confiável: diz isso, não inventa', () => {
    const sim = simulateRule({ name: 'x', trigger: { kind: 'clientStatus' }, conditions: [], actions: [{ kind: 'addInbox', text: 'x' }] }, base(), settings, ctx().convert, TODAY, NOW)
    expect(sim.possible).toBe(false)
    expect(NO_HISTORY).toBe('Não há histórico suficiente para simular este gatilho.')
    const done = simulateRule({ name: 'x', trigger: { kind: 'projectDone' }, conditions: [], actions: [{ kind: 'addInbox', text: 'x' }] }, data({ projects: [project('p1', { status: 'done', endDate: TODAY })] }), settings, ctx().convert, TODAY, NOW)
    expect(done.ranCount).toBe(1)
    expect(done.notes.join(' ')).toContain('Aproximado')
  })
})

// ------------------------------------------------------------------ Moedas
describe('condição de valor com conversão', () => {
  const d = data({ financeGoals: [goal('imp')], rules: [] })
  const conv = (over = {}) => rule('moneyIn', [{ kind: 'addInbox', text: 'grande' }], [{ field: 'amount', op: 'gt', value: 50000, currency: 'EUR', compare: 'base', ...over }], { id: 'c' })

  it('mesma moeda funciona como antes; sem a opção, outra moeda nunca combina', () => {
    expect(ruleRuns(write({ ...d, rules: [conv()] }, [put('transactions', income(60000))]).extra)).toHaveLength(1)
    const old = rule('moneyIn', [{ kind: 'addInbox', text: 'x' }], [{ field: 'amount', op: 'gt', value: 50000, currency: 'EUR' }])
    expect(ruleRuns(write({ ...d, rules: [old] }, [put('transactions', income(600000, 'BRL'))]).extra)).toHaveLength(0)
  })

  it('com a opção: converte pela cotação do app e grava moeda, valor, convertido, cotação e momento', () => {
    const s = { ...settings, rates: { values: { EUR: 1, BRL: 6 }, fetchedAt: '2026-10-19T06:00:00.000Z', source: 't' } }
    const ops = planRulesForWrite({ ...d, rules: [conv()] }, [put('transactions', income(600000, 'BRL'))], 'person', ctx({ settings: s }))
    const [run] = ruleRuns(ops)
    expect(run.status).toBe('done')
    expect(run.cause?.conversion).toEqual({ from: 'BRL', amount: 600000, to: 'EUR', converted: 100000, rate: 0.166667, rateAt: '2026-10-19T06:00:00.000Z' })
  })

  it('sem cotação: a regra não roda e registra o motivo', () => {
    const [run] = ruleRuns(write({ ...d, rules: [conv()] }, [put('transactions', income(10000, 'JPY'))]).extra)
    expect(run).toMatchObject({ status: 'skipped', summary: expect.stringContaining('não rodou'), detail: expect.stringContaining('sem cotação de JPY') })
    expect(run.created).toEqual([])
  })

  it('trocar a moeda principal não muda a regra: continua comparando com €500', () => {
    const s = { ...settings, baseCurrency: 'BRL' }
    const ops = planRulesForWrite({ ...d, rules: [conv()] }, [put('transactions', income(240000, 'BRL'))], 'person', ctx({ settings: s }))
    expect(ruleRuns(ops)).toHaveLength(0) // R$2.400 = €400 < €500
  })
})

// ------------------------------------------------------------------ Tentar de novo
describe('tentar de novo', () => {
  const r = rule('projectPayment', [{ kind: 'reservePercent', goalId: 'imp', percent: 20 }, { kind: 'createTask', title: 'Recibo', dueDays: 0, linkProject: true, priority: 'none' }], [], { id: 'imp-rule', name: 'Impostos' })
  const start = data({ rules: [r], projects: [project('p1')], clients: [client()], financeGoals: [goal('imp', { name: 'Impostos', inBalance: false })] })
  const first = write(start, [put('transactions', projectIncome(100000))])
  const run0 = ruleRuns(first.extra)[0]
  // The person puts the goal in the balance, then taps "Tentar de novo".
  const fixed = { ...first.after, financeGoals: first.after.financeGoals.map((g) => ({ ...g, inBalance: true })) }

  it('falhou só a reserva; tentar de novo faz SÓ a reserva e registra a tentativa', () => {
    expect(run0.actions!.map((a) => [a.ok, a.code])).toEqual([[false, 'goalNotInBalance'], [true, undefined]])
    const plan = planRetry(run0, 0, fixed, ctx(), true)
    if (typeof plan === 'string') throw new Error(plan)
    const after = applyOps(fixed, plan.ops)
    expect((after.financeGoals[0] as FinanceGoal).saved).toBe(20000)
    expect(after.tasks).toHaveLength(1) // a tarefa não é criada de novo
    const run1 = after.automationRuns.find((x) => x.id === run0.id)!
    expect(run1.actions![0]).toMatchObject({ ok: true, attempts: [{ id: `${run0.id}-a0-t1`, ok: true }] })
    expect(run1.changed.filter((c) => c.action === 0)).toHaveLength(1)
    // De novo (reload, toque repetido, outro aparelho já sincronizado): bloqueado.
    expect(planRetry(run1, 0, after, ctx(), true)).toBe('Esta ação já foi feita.')
    expect(planRetry(run1, 1, after, ctx(), true)).toBe('Esta ação já foi feita.')
  })

  it('logado e offline (ou com envio pendente): bloqueia em vez de arriscar reservar duas vezes', () => {
    expect(planRetry(run0, 0, fixed, ctx(), false)).toContain('espere a sincronização')
  })

  it('motivo definitivo, execução desfeita ou execução antiga sem a definição: sem tentar de novo', () => {
    const final = { ...run0, actions: [{ ...run0.actions![0], code: 'final' as const }, run0.actions![1]] }
    expect(planRetry(final, 0, fixed, ctx(), true)).toContain('não muda sozinho')
    expect(planRetry({ ...run0, status: 'undone' }, 0, fixed, ctx(), true)).toBe('Esta execução foi desfeita.')
    const old = { ...run0, actions: [{ text: 'x', ok: false }, run0.actions![1]] }
    expect(planRetry(old, 0, fixed, ctx(), true)).toContain('antes do “Tentar de novo”')
  })

  it('tentativa que ainda falha fica registrada e a próxima tem outro id', () => {
    const plan = planRetry(run0, 0, first.after, ctx(), true) // meta ainda fora do saldo
    if (typeof plan === 'string') throw new Error(plan)
    expect(plan.ok).toBe(false)
    const run1 = applyOps(first.after, plan.ops).automationRuns.find((x) => x.id === run0.id)!
    expect(run1.actions![0].attempts).toHaveLength(1)
    const again = planRetry(run1, 0, fixed, ctx(), true)
    if (typeof again === 'string') throw new Error(again)
    expect(applyOps(fixed, again.ops).automationRuns.find((x) => x.id === run0.id)!.actions![0].attempts!.map((t) => t.id)).toEqual([`${run0.id}-a0-t1`, `${run0.id}-a0-t2`])
  })
})

// ------------------------------------------------------------------ Desfazer uma ação
describe('desfazer só uma ação', () => {
  const r = rule(
    'projectPayment',
    [
      { kind: 'reservePercent', goalId: 'imp', percent: 10 },
      { kind: 'createTask', title: 'Recibo', dueDays: 0, linkProject: true, priority: 'none' },
      { kind: 'createNote', title: 'Nota', body: '' },
      { kind: 'clientStatus', status: 'done' },
    ],
    [],
    { id: 'multi' },
  )
  const { extra, after } = write(data({ rules: [r], projects: [project('p1')], clients: [client()], financeGoals: [goal('imp')] }), [put('transactions', projectIncome(100000))])
  const run = ruleRuns(extra)[0]
  const one = (i: number, d = after, rr = run) => {
    const res = undoAction(rr, i, d, TODAY)!
    return { ...res, d: applyOps(d, res.ops), run: applyOps(d, res.ops).automationRuns.find((x) => x.id === rr.id)! }
  }

  it('reserva, tarefa, nota e status: cada um sozinho; o resto fica', () => {
    const a = one(0)
    expect((a.d.financeGoals[0] as FinanceGoal).saved).toBe(0)
    expect(a.d.tasks).toHaveLength(1)
    expect(a.run.status).toBe('done')
    expect(one(1).d.tasks).toHaveLength(0)
    expect(one(2).d.notes).toHaveLength(0)
    expect(one(3).d.clients[0].status).toBe('active')
  })

  it('item alterado depois pela pessoa: não apaga nem sobrescreve', () => {
    const edited = { ...after, tasks: after.tasks.map((t) => ({ ...t, title: 'Recibo (mudei)' })), clients: after.clients.map((c) => ({ ...c, status: 'archived' as const })) }
    expect(one(1, edited).d.tasks).toHaveLength(1)
    expect(one(1, edited).partial).toBe(true)
    expect(one(3, edited).d.clients[0].status).toBe('archived')
  })

  it('“Desfazer tudo” depois de desfazer uma ação não desfaz aquela duas vezes; todas desfeitas → execução desfeita', () => {
    const a = one(0)
    const all = undoRun(a.run, a.d, TODAY)
    const d2 = applyOps(a.d, all.ops)
    expect((d2.financeGoals[0] as FinanceGoal).saved).toBe(0)
    let state = after
    let rr = run
    for (const i of [0, 1, 2, 3]) {
      const x = one(i, state, rr)
      state = x.d
      rr = x.run
    }
    expect(rr.status).toBe('undone')
  })

  it('execuções da 2.0 (sem marcação por ação) só oferecem desfazer tudo', () => {
    const old = { ...run, created: run.created.map(({ action: _a, ...e }) => e), changed: run.changed.map(({ action: _a, ...e }) => e) }
    expect(undoAction(old as AutomationRun, 1, after, TODAY)).toBeNull()
  })
})

// ------------------------------------------------------------------ Cadeias
describe('cadeias de regras', () => {
  const base = { projects: [project('p1')], clients: [client()] }
  const A = (chain = true) => rule('projectDone', [{ kind: 'createTask', title: 'Pedir avaliação', dueDays: 3, linkProject: true, priority: 'none' }], [], { id: 'A', name: 'A', chain, order: 0 })
  const B = (chain = false) => rule('taskCreated', [{ kind: 'addInbox', text: 'Lembrar {tarefa}' }], [{ field: 'text', contains: 'avaliação' }], { id: 'B', name: 'B', chain, order: 1 })
  const done = [put('projects', { ...project('p1'), status: 'done' })]

  it('desligada por padrão: A não dispara B (comportamento da 2.0)', () => {
    const { extra } = write(data({ ...base, rules: [A(false), B()] }), done)
    expect(ruleRuns(extra).map((r) => r.rule!.id)).toEqual(['A'])
  })

  it('A → B, com a cadeia registrada', () => {
    const { extra } = write(data({ ...base, rules: [A(), B()] }), done)
    const runs = ruleRuns(extra)
    expect(runs.map((r) => r.rule!.id)).toEqual(['A', 'B'])
    expect(runs[1].chain).toEqual({ rootRunId: runs[0].id, path: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], depth: 1 })
    expect(puts(extra, 'inbox')[0].text).toBe('Lembrar Pedir avaliação')
  })

  it('A → B → C; profundidade máxima 3 (D não roda)', () => {
    const B2 = rule('taskCreated', [{ kind: 'createTask', title: 'Segunda', dueDays: null, linkProject: false, priority: 'none' }], [{ field: 'text', contains: 'avaliação' }], { id: 'B', name: 'B', chain: true, order: 1 })
    const C = rule('taskCreated', [{ kind: 'createTask', title: 'Terceira', dueDays: null, linkProject: false, priority: 'none' }], [{ field: 'text', contains: 'segunda' }], { id: 'C', name: 'C', chain: true, order: 2 })
    const D = rule('taskCreated', [{ kind: 'addInbox', text: 'D' }], [{ field: 'text', contains: 'terceira' }], { id: 'D', name: 'D', order: 3 })
    const { extra } = write(data({ ...base, rules: [A(), B2, C, D] }), done)
    expect(ruleRuns(extra).map((r) => r.rule!.id)).toEqual(['A', 'B', 'C'])
    expect(MAX_CHAIN_DEPTH).toBe(3)
  })

  it('impede A → A e A → B → A', () => {
    const self = rule('taskCreated', [{ kind: 'createTask', title: 'De novo', dueDays: null, linkProject: false, priority: 'none' }], [], { id: 'S', name: 'S', chain: true })
    const one = write(data({ ...base, rules: [self] }), [put('tasks', task('t1'))])
    expect(ruleRuns(one.extra)).toHaveLength(1)
    expect(puts(one.extra, 'tasks')).toHaveLength(1)
    const a = rule('taskCreated', [{ kind: 'createTask', title: 'b', dueDays: null, linkProject: false, priority: 'none' }], [{ field: 'text', contains: 'a' }], { id: 'a', name: 'a', chain: true, order: 0 })
    const b = rule('taskCreated', [{ kind: 'createTask', title: 'a', dueDays: null, linkProject: false, priority: 'none' }], [{ field: 'text', contains: 'b' }], { id: 'b', name: 'b', chain: true, order: 1 })
    const loop = write(data({ ...base, rules: [a, b] }), [put('tasks', task('t1', { title: 'a' }))])
    expect(ruleRuns(loop.extra).map((r) => r.rule!.id)).toEqual(['a', 'b'])
  })

  it('dois aparelhos / repetição: mesmos ids em toda a cadeia, nada duplica', () => {
    const d = data({ ...base, rules: [A(), B()] })
    const one = ruleRuns(write(d, done).extra).map((r) => r.id)
    const two = ruleRuns(write(d, done).extra).map((r) => r.id)
    expect(two).toEqual(one)
    const after = write(d, done).after
    expect(ruleRuns(write(after, done).extra)).toEqual([]) // já gravadas: não roda de novo
  })
})

// ------------------------------------------------------------------ Compatibilidade
describe('compatibilidade com a 2.0', () => {
  it('regra antiga (sem campos novos) roda igual e a execução antiga ainda se desfaz', () => {
    const r = rule('moneyIn', [{ kind: 'reservePercent', goalId: 'g', percent: 10 }])
    const { extra, after } = write(data({ rules: [r], financeGoals: [goal('g')] }), [put('transactions', income(100000))])
    const run = ruleRuns(extra)[0]
    expect((after.financeGoals[0] as FinanceGoal).saved).toBe(10000)
    const old = { ...run, actions: run.actions!.map((a) => ({ text: a.text, ok: a.ok })), changed: run.changed.map(({ action: _a, ...e }) => e) } as AutomationRun
    const undone = applyOps(after, undoRun(old, after, TODAY).ops)
    expect((undone.financeGoals[0] as FinanceGoal).saved).toBe(0)
  })

  it('conversor sem cotação nenhuma não quebra regra sem conversão', () => {
    const r = rule('moneyIn', [{ kind: 'addInbox', text: 'x' }], [{ field: 'amount', op: 'gt', value: 100, currency: 'EUR' }])
    expect(ruleRuns(planRulesForWrite(data({ rules: [r] }), [put('transactions', income(600000, 'BRL'))], 'person', ctx({ convert: makeConverter(null) })))).toHaveLength(0)
  })
})
