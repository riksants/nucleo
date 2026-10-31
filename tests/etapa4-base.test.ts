/**
 * Etapa 4.1 — base: desfazer seguro dos pagamentos automáticos, leitor único de valores e moeda das metas do
 * Assistente (nunca a moeda principal quando a frase diz outra).
 */
import { describe, expect, it } from 'vitest'
import { runIntent } from '../src/core/assistant/actions'
import { readIntent } from '../src/core/assistant/intents'
import { confirmSubscriberCharge, planSubscriberCharges } from '../src/core/automation/subscriberCharge'
import { planToolCharges, toolRunId, toolTxId } from '../src/core/automation/toolCharge'
import type { AutomationRun, BatchOp } from '../src/core/automation/types'
import { undoRun } from '../src/core/automation/undo'
import { applyOps } from '../src/core/rules/work'
import { onlyCurrency, readAmount, readAmounts } from '../src/core/smart/amount'
import type { DataState, Subscriber, Tool, Transaction } from '../src/data/types'
import { baseSettings, makeCtx, T } from './automation-helpers'

const tool = (over: Partial<Tool> = {}): Tool => ({
  id: 't1', createdAt: T, updatedAt: T, name: 'Figma', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: '2026-10-20', notes: '', status: 'active', autoPaid: true, ...over,
})
const removes = (ops: BatchOp[], collection: string) => ops.filter((o) => o.op === 'remove' && o.collection === collection).map((o) => (o as { id: string }).id)

function paidTool(): { data: DataState; run: AutomationRun; tx: Transaction } {
  const ctx = makeCtx({ tools: [tool()] }, '2026-10-21')
  const [p] = planToolCharges(ctx, '2026-10-01')
  const data = applyOps(ctx.data, p.ops)
  const run = data.automationRuns.find((r) => r.id === toolRunId('t1', '2026-10-20'))!
  const tx = data.transactions.find((t) => t.id === toolTxId(run.id))!
  return { data, run, tx }
}

describe('4.1 · desfazer pagamento automático não apaga o que a pessoa editou', () => {
  it('pagamento novo guarda a marca de como foi criado', () => {
    const { run } = paidTool()
    expect(run.created[0].fp).toBeTruthy()
  })

  it('sem edição: desfazer remove a saída', () => {
    const { data, run, tx } = paidTool()
    const { ops, partial } = undoRun(run, data, '2026-10-21')
    expect(partial).toBe(false)
    expect(removes(ops, 'transactions')).toEqual([tx.id])
  })

  it('valor editado depois: a saída fica, e a tela é avisada', () => {
    const { data, run, tx } = paidTool()
    const edited = { ...data, transactions: data.transactions.map((t) => (t.id === tx.id ? { ...t, amount: 2500, baseAmount: -2500, updatedAt: '2026-10-22T09:00:00.000Z' } : t)) }
    const { ops, partial } = undoRun(run, edited, '2026-10-22')
    expect(partial).toBe(true)
    expect(removes(ops, 'transactions')).toEqual([])
  })

  it('categoria aplicada por uma regra na mesma gravação não conta como edição', () => {
    const { data, run, tx } = paidTool()
    const ruleRun: AutomationRun = {
      id: 'rule-x', createdAt: T, updatedAt: T, automation: 'rule', date: '2026-10-21', summary: '', origin: { collection: 'transactions', id: tx.id, label: '' },
      created: [], changed: [{ collection: 'transactions', id: tx.id, field: 'category', before: 'subscriptions', after: 'work', action: 0 }], status: 'done', actions: [{ text: 'categoria', ok: true }],
    }
    const state = { ...data, automationRuns: [...data.automationRuns, ruleRun], transactions: data.transactions.map((t) => (t.id === tx.id ? { ...t, category: 'work' } : t)) }
    const { ops, partial } = undoRun(run, state, '2026-10-21')
    expect(partial).toBe(false)
    expect(removes(ops, 'transactions')).toEqual([tx.id])
  })

  it('execução antiga (sem marca): movimentação regravada bem depois fica', () => {
    const { data, run, tx } = paidTool()
    const legacy = { ...run, created: [{ collection: 'transactions' as const, id: tx.id }], updatedAt: '2026-10-21T10:00:00.000Z' }
    const later = { ...data, transactions: data.transactions.map((t) => (t.id === tx.id ? { ...t, reason: 'Figma (time)', updatedAt: '2026-10-25T10:00:00.000Z' } : t)) }
    expect(undoRun(legacy, later, '2026-10-25').partial).toBe(true)
    const same = { ...data, transactions: data.transactions.map((t) => (t.id === tx.id ? { ...t, updatedAt: '2026-10-21T10:00:00.500Z' } : t)) }
    expect(removes(undoRun(legacy, same, '2026-10-21').ops, 'transactions')).toEqual([tx.id])
  })

  it('confirmação de assinante editada depois: nada é desfeito (pagamento e entrada ficam)', () => {
    const sub: Subscriber = { id: 's1', createdAt: T, updatedAt: T, name: 'Ana', planId: 'p1', status: 'active', nextCharge: '2026-10-05', payments: [], notes: '', email: '', phone: '' } as unknown as Subscriber
    const plan = { id: 'p1', createdAt: T, updatedAt: T, offeringId: 'o1', name: 'Mensal', price: 5000, currency: 'EUR', interval: 'monthly' }
    const ctx = makeCtx({ subscribers: [sub], subPlans: [plan as never] }, '2026-10-06')
    const [p] = planSubscriberCharges(ctx, '2026-10-01')
    let data = applyOps(ctx.data, p.ops)
    const pending = data.automationRuns[0]
    const ops = confirmSubscriberCharge(pending, { amount: 5000, date: '2026-10-06' }, { ...ctx, data }) as BatchOp[]
    data = applyOps(data, ops)
    const done = data.automationRuns.find((r) => r.id === pending.id)!
    expect(done.created[0].fp).toBeTruthy()
    const txId = done.created[0].id
    const edited = { ...data, transactions: data.transactions.map((t) => (t.id === txId ? { ...t, amount: 4000, baseAmount: 4000 } : t)) }
    const r = undoRun(done, edited, '2026-10-07')
    expect(r.partial).toBe(true)
    expect(r.ops).toEqual([])
  })
})

describe('4.1 · leitor único de valores', () => {
  it('lê moedas escritas e deixa a moeda vazia quando não foi dita', () => {
    expect(readAmount('Gastei 45 reais no mercado hoje')).toMatchObject({ cents: 4500, currency: 'BRL' })
    expect(readAmount('Recebi 300 euros do João pelo site')).toMatchObject({ cents: 30000, currency: 'EUR' })
    expect(readAmount('Assinei uma ferramenta de 12 euros por mês')).toMatchObject({ cents: 1200, currency: 'EUR' })
    expect(readAmount('R$ 1.234,56')).toMatchObject({ cents: 123456, currency: 'BRL' })
    expect(readAmount('€12,50 café')).toMatchObject({ cents: 1250, currency: 'EUR' })
    expect(readAmount('AED 300')).toMatchObject({ cents: 30000, currency: 'AED' })
    expect(readAmount('2 mil reais')).toMatchObject({ cents: 200000, currency: 'BRL' })
    expect(readAmount('gastei 45 no mercado')).toMatchObject({ cents: 4500, currency: null })
    expect(readAmount('$ 20')).toMatchObject({ cents: 2000, currency: null })
  })

  it('horas, datas e contagens não são dinheiro', () => {
    expect(readAmounts('Tenho reunião amanhã às 14h')).toEqual([])
    expect(readAmounts('Treino segunda, quarta e sexta às 8h')).toEqual([])
    expect(readAmounts('3 séries de 12 repetições')).toEqual([])
    expect(readAmounts('dia 15/10 paguei 45,90').map((a) => a.cents)).toEqual([4590])
  })

  it('venda com pagamento parcial: os dois valores, cada um com o que foi dito', () => {
    const a = readAmounts('Vendi um celular por 1.200 reais, recebi 500 e o restante fica para sexta')
    expect(a.map((x) => [x.cents, x.currency])).toEqual([
      [120000, 'BRL'],
      [50000, null],
    ])
  })

  it('moeda só é tomada sem perguntar quando a pessoa usa uma só', () => {
    expect(onlyCurrency(baseSettings)).toBeNull()
    expect(onlyCurrency({ ...baseSettings, currencies: ['EUR', 'BRL'] })).toBeNull()
    expect(onlyCurrency({ ...baseSettings, currencies: ['EUR'] })).toBe('EUR')
  })
})

describe('4.1 · meta do Assistente na moeda escrita', () => {
  const today = '2026-10-31'
  it('“R$ 5.000” vira meta em BRL mesmo com a moeda principal em euro', () => {
    const intent = readIntent('Quero guardar R$ 5.000 até dezembro', today)
    expect(intent).toMatchObject({ type: 'createFinanceGoal', target: 500000, currency: 'BRL' })
    const r = runIntent(intent, { data: makeCtx({}, today).data, settings: baseSettings, now: new Date(`${today}T10:00:00.000Z`) })
    expect(r.proposal?.changes[0].ops[0]).toMatchObject({ record: { currency: 'BRL', target: 500000 } })
  })

  it('“500 euros” é entendido', () => {
    expect(readIntent('Quero juntar 500 euros para a viagem até dezembro', today)).toMatchObject({ type: 'createFinanceGoal', target: 50000, currency: 'EUR' })
  })

  it('sem moeda e com várias moedas: pergunta, não cria nada', () => {
    const intent = readIntent('Quero guardar 5 mil até dezembro', today)
    const r = runIntent(intent, { data: makeCtx({}, today).data, settings: baseSettings, now: new Date(`${today}T10:00:00.000Z`) })
    expect(r.proposal).toBeUndefined()
    expect(r.lines.join(' ')).toMatch(/Em qual moeda/)
  })
})
