import { describe, expect, it } from 'vitest'
import { markSuggestion, ruleSuggestions, visibleSuggestion } from '../src/core/rules/suggestions'
import { TEMPLATES } from '../src/core/rules/templates'
import type { AutomationRun, DataState, Transaction } from '../src/data/types'
import { addDaysToDate } from '../src/core/period'
import { client, data, goal, project, rule, sale, settings, task, TODAY, tx } from './rules-helpers'

const at = (day: string) => `${day}T12:00:00.000Z`
const ago = (n: number) => addDaysToDate(TODAY, -n)

/** Project payments on these days (ago), each followed the next day by a hand reservation of `pct`%. */
function paymentsWithReserve(daysAgo: number[], pct: number[], amount = 100000) {
  const transactions: Transaction[] = daysAgo.map((n, i) => tx(`rcv-project-${i}`, { amount, baseAmount: amount, createdAt: at(ago(n)), source: { kind: 'project', parentId: 'p1', paymentId: `${i}` } }))
  let saved = 0
  const history = [{ date: ago(120), saved: 0 }]
  daysAgo.forEach((n, i) => {
    if (pct[i] === undefined) return
    saved += Math.round((amount * pct[i]) / 100)
    history.push({ date: ago(n - 1), saved })
  })
  return { transactions, financeGoals: [goal('g1', { name: 'Impostos', saved, history })] }
}

const keys = (d: Partial<DataState>) => ruleSuggestions(data(d), settings, TODAY).map((s) => s.key)

describe('sugestão: reservar parte do que recebe', () => {
  it('4 pagamentos com ~20% guardados → sugere, com o porquê e a regra pronta (desligada até salvar)', () => {
    const [s] = ruleSuggestions(data(paymentsWithReserve([60, 45, 30, 10], [20, 21, 19, 20])), settings, TODAY)
    expect(s.key).toBe('reserve:project:g1:20')
    expect(s.title).toContain('cerca de 20%')
    expect(s.items).toHaveLength(4)
    expect(s.draft).toMatchObject({ trigger: { kind: 'projectPayment' }, actions: [{ kind: 'reservePercent', goalId: 'g1', percent: 20 }] })
  })

  it('3 vezes só, percentuais espalhados, ou poucas das chances → não sugere', () => {
    expect(keys(paymentsWithReserve([45, 30, 10], [20, 20, 20]))).toEqual([])
    expect(keys(paymentsWithReserve([60, 45, 30, 10], [5, 20, 40, 60]))).toEqual([])
    expect(keys(paymentsWithReserve([70, 60, 50, 45, 30, 20, 10], [20, 20, 20, 20]))).toEqual([])
  })

  it('tudo junto em poucos dias, ou a última há muito tempo → não sugere', () => {
    expect(keys(paymentsWithReserve([16, 14, 12, 10], [20, 20, 20, 20]))).toEqual([])
    expect(keys(paymentsWithReserve([89, 80, 70, 60], [20, 20, 20, 20]))).toEqual([])
  })

  it('reservas feitas por automação ou regra não contam como hábito da pessoa', () => {
    const d = paymentsWithReserve([60, 45, 30, 10], [20, 20, 20, 20])
    const runs = d.financeGoals[0].history.slice(1).map((h, i) => ({ id: `r${i}`, automation: 'rule', status: 'done', date: h.date, changed: [{ collection: 'financeGoals', id: 'g1', field: 'saved' }] }) as unknown as AutomationRun)
    expect(keys({ ...d, automationRuns: runs })).toEqual([])
  })

  it('já existe regra igual → não sugere', () => {
    const d = paymentsWithReserve([60, 45, 30, 10], [20, 20, 20, 20])
    expect(keys({ ...d, rules: [rule('projectPayment', [{ kind: 'reservePercent', goalId: 'g1', percent: 25 }])] })).toEqual([])
  })
})

describe('sugestão: tarefa depois de concluir projeto / de vender', () => {
  const projects = [10, 20, 30].map((n, i) => project(`p${i}`, { name: `Site ${i}`, status: 'done', endDate: ago(n), clientId: 'c1' }))
  const followUps = projects.map((p, i) => task(`t${i}`, { title: 'Pedir avaliação a Ana', projectId: p.id, createdAt: at(addDaysToDate(p.endDate, 1)), dueDate: addDaysToDate(p.endDate, 4) }))

  it('3 de 3 projetos concluídos com tarefa até 3 dias depois → sugere com {cliente} no título', () => {
    const [s] = ruleSuggestions(data({ projects, tasks: followUps, clients: [client()] }), settings, TODAY)
    expect(s.draft).toMatchObject({ trigger: { kind: 'projectDone' }, actions: [{ kind: 'createTask', title: 'Pedir avaliação a {cliente}', dueDays: 3, linkProject: true }] })
  })

  it('tarefas criadas por regra não contam; 2 de 4 não basta', () => {
    expect(keys({ projects, tasks: followUps.map((t) => ({ ...t, id: `rule-x-${t.id}` })), clients: [client()] })).toEqual([])
    const more = [...projects, project('p9', { status: 'done', endDate: ago(5) })]
    expect(keys({ projects: more, tasks: followUps.slice(0, 2), clients: [client()] })).toEqual([])
  })

  it('vendas seguidas de tarefa citando o comprador → sugere acompanhar', () => {
    const sales = [40, 25, 8].map((n, i) => sale(`s${i}`, { clientName: 'Maria Souza', product: 'Tênis', createdAt: at(ago(n)) }))
    const tasks = sales.map((s, i) => task(`f${i}`, { title: 'Ligar para Maria Souza', createdAt: s.createdAt }))
    const [s] = ruleSuggestions(data({ sales, tasks }), settings, TODAY)
    expect(s.draft).toMatchObject({ trigger: { kind: 'saleCreated' }, actions: [{ kind: 'createTask', title: 'Ligar para {cliente}' }] })
  })
})

describe('sugestão: despesa repetida vira conta fixa (nunca regra que cria despesa)', () => {
  const rent = (day: string, amount = 80000) => tx(`out-${day}`, { type: 'out', amount, baseAmount: -amount, reason: 'Aluguel', createdAt: at(day) })
  const withTools = { ...settings, modules: { tools: true } }

  it('3 meses seguidos perto do dia 5 → “Cadastrar como conta fixa”, sem rascunho de regra', () => {
    const [s] = ruleSuggestions(data({ transactions: [rent('2026-08-05'), rent('2026-09-04'), rent('2026-10-06', 81000)] }), withTools, TODAY)
    expect(s.fixedExpense).toEqual({ name: 'Aluguel', amount: 80000, currency: 'EUR', day: 5 })
    expect(s.draft).toBeUndefined()
  })

  it('mês pulado, valor muito diferente ou já cadastrada como assinatura → não sugere', () => {
    expect(ruleSuggestions(data({ transactions: [rent('2026-06-05'), rent('2026-08-05'), rent('2026-10-05')] }), withTools, TODAY)).toEqual([])
    expect(ruleSuggestions(data({ transactions: [rent('2026-08-05'), rent('2026-09-05', 20000), rent('2026-10-05')] }), withTools, TODAY)).toEqual([])
    const tool = { id: 'x', name: 'Aluguel', status: 'active' } as never
    expect(ruleSuggestions(data({ tools: [tool], transactions: [rent('2026-08-05'), rent('2026-09-05'), rent('2026-10-05')] }), withTools, TODAY)).toEqual([])
  })
})

describe('respostas às sugestões', () => {
  const list = ruleSuggestions(data(paymentsWithReserve([60, 45, 30, 10], [20, 20, 20, 20])), settings, TODAY)

  it('“Não sugerir isso novamente” não volta; “Agora não” volta depois de 30 dias', () => {
    const key = list[0].key
    const dismissed = markSuggestion({}, key, { s: 'dismissed' })
    expect(visibleSuggestion(list, dismissed, TODAY)).toBeNull()
    expect(visibleSuggestion(list, dismissed, '2030-01-01')).toBeNull()
    const snoozed = markSuggestion({}, key, { s: 'snoozed', until: addDaysToDate(TODAY, 30) })
    expect(visibleSuggestion(list, snoozed, addDaysToDate(TODAY, 29))).toBeNull()
    expect(visibleSuggestion(list, snoozed, addDaysToDate(TODAY, 30))?.key).toBe(key)
  })
})

describe('modelos prontos', () => {
  it('nenhum vem ligado; os de reserva pedem a meta; os textos usam marcadores conhecidos', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8)
    for (const t of TEMPLATES) {
      const d = t.draft('EUR')
      expect('on' in d).toBe(false)
      expect(t.needsGoal).toBe(d.actions.some((a) => 'goalId' in a && a.goalId === ''))
    }
  })
})
