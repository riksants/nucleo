import { describe, expect, it } from 'vitest'
import { automationSince, planAll, sinceDefaults } from '../src/core/automation/engine'
import type { AutomationCtx, BatchOp } from '../src/core/automation/types'
import { undoRun } from '../src/core/automation/undo'
import { confirmSubscriberCharge } from '../src/core/automation/subscriberCharge'
import { confirmToolCharge } from '../src/core/automation/toolCharge'
import type { CollectionName, DataState, Entity, FinanceGoal, Settings, SubPlan, Subscriber, Tool } from '../src/data/types'
import { baseSettings, makeCtx, T } from './automation-helpers'

const on = (since: string): Settings => ({
  ...baseSettings,
  automations: { subscriberCharge: { on: true, since }, toolCharge: { on: true, since }, projectClient: { on: true, since }, goalSave: { on: true, since } },
})
const plan: SubPlan = { id: 'p1', createdAt: T, updatedAt: T, offeringId: 'o1', name: 'Pro', price: 5000, currency: 'EUR', interval: 'monthly' }
const sub = (over: Partial<Subscriber> = {}): Subscriber => ({
  id: 's1', createdAt: T, updatedAt: T, offeringId: 'o1', planId: 'p1', name: 'Ana', clientId: null, email: '', startDate: '2026-01-05',
  nextCharge: '2026-10-05', status: 'active', cancelledAt: '', payments: [], notes: '', paymentMode: 'autoPaid', ...over,
})
const tool: Tool = { id: 't1', createdAt: T, updatedAt: T, name: 'Figma', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: '2026-10-05', notes: '', status: 'active', autoPaid: true }
const goal: FinanceGoal = {
  id: 'g1', createdAt: T, updatedAt: T, name: 'Viagem', target: 120000, saved: 0, deadline: '2027-03-31', currency: 'EUR', note: '', status: 'active', history: [],
  inBalance: true, autoSave: { day: 5, mode: 'fixed', amount: 10000, since: '2026-10-01' },
}
const cash = { id: 'cash', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: T, type: 'in' as const, amount: 100000, currency: 'EUR', baseAmount: 100000, reason: 'saldo' }

/** Applies ops the way Repository.batch does. */
function apply(data: DataState, ops: BatchOp[]): DataState {
  const next = { ...data } as Record<CollectionName, Entity[]>
  for (const o of ops) {
    const list = next[o.collection]
    next[o.collection] = o.op === 'remove' ? list.filter((x) => x.id !== o.id) : [...list.filter((x) => x.id !== o.item.id), o.item]
  }
  return next as unknown as DataState
}
const pass = (ctx: AutomationCtx) => apply(ctx.data, planAll(ctx).flatMap((p) => p.ops))

describe('motor', () => {
  it('automação sem data de início ainda não age; a primeira passada grava "desde hoje" para todas', () => {
    expect(automationSince(baseSettings, 'toolCharge')).toBeNull()
    const defaults = sinceDefaults(baseSettings, '2026-10-12')!
    expect(defaults.toolCharge).toEqual({ on: true, since: '2026-10-12' })
    expect(sinceDefaults({ ...baseSettings, automations: defaults }, '2026-10-20')).toBeNull()
  })

  it('desligada não faz nada', () => {
    const s = { ...on('2026-10-01'), automations: { ...on('2026-10-01').automations, toolCharge: { on: false, since: '2026-10-01' } } }
    const ctx = makeCtx({ tools: [tool] }, '2026-10-06', { settings: s })
    expect(planAll(ctx)).toEqual([])
  })

  it('idempotente: rodar de novo depois de gravar não faz nada', () => {
    const ctx = makeCtx({ subscribers: [sub()], subPlans: [plan], tools: [tool], financeGoals: [goal], transactions: [cash] }, '2026-10-06', { settings: on('2026-10-01') })
    const once = pass(ctx)
    expect(once.automationRuns).toHaveLength(3)
    expect(planAll({ ...ctx, data: once })).toEqual([])
  })

  it('desfazer pagamento automático de assinante: remove pagamento e entrada, volta a próxima cobrança', () => {
    const ctx = makeCtx({ subscribers: [sub()], subPlans: [plan] }, '2026-10-06', { settings: on('2026-10-01') })
    const data = pass(ctx)
    const run = data.automationRuns[0]
    const { ops, partial } = undoRun(run, data, '2026-10-07')
    const after = apply(data, ops)
    expect(partial).toBe(false)
    expect(after.transactions).toEqual([])
    expect(after.subscribers[0].payments).toEqual([])
    expect(after.subscribers[0].nextCharge).toBe('2026-10-05')
    expect(after.automationRuns[0].status).toBe('undone')
    // undone stays registered: never redone, and the date it restored is not moved again
    expect(planAll({ ...ctx, data: after })).toEqual([])
  })

  it('desfazer a saída de ferramenta: a data volta e a próxima passada não a move de novo', () => {
    const ctx = makeCtx({ tools: [tool] }, '2026-10-06', { settings: on('2026-10-01') })
    const data = pass(ctx)
    const after = apply(data, undoRun(data.automationRuns[0], data, '2026-10-07').ops)
    expect(after.tools[0].nextCharge).toBe('2026-10-05')
    expect(planAll({ ...ctx, data: after })).toEqual([])
  })

  it('a pessoa mudou a próxima cobrança depois: desfazer preserva a edição dela', () => {
    const ctx = makeCtx({ tools: [tool] }, '2026-10-06', { settings: on('2026-10-01') })
    const data = pass(ctx)
    const edited = { ...data, tools: [{ ...data.tools[0], nextCharge: '2026-11-15' }] }
    const { ops, partial } = undoRun(edited.automationRuns[0], edited, '2026-10-07')
    const after = apply(edited, ops)
    expect(partial).toBe(true)
    expect(after.tools[0].nextCharge).toBe('2026-11-15')
    expect(after.transactions).toEqual([])
  })

  it('desfazer uma confirmação: a cobrança volta para "A receber" (dá para confirmar de novo), sem dinheiro', () => {
    const ctx = makeCtx({ subscribers: [sub({ paymentMode: 'confirm' })], subPlans: [plan] }, '2026-10-06', { settings: on('2026-10-01') })
    const pending = pass(ctx)
    const ops = confirmSubscriberCharge(pending.automationRuns[0], { amount: 5000, date: '2026-10-06' }, { ...ctx, data: pending })
    if (typeof ops === 'string') throw new Error(ops)
    const confirmed = apply(pending, ops)
    const after = apply(confirmed, undoRun(confirmed.automationRuns[0], confirmed, '2026-10-07').ops)
    expect(after.automationRuns[0]).toMatchObject({ status: 'pending', summary: 'Cobrança de Ana: a receber', created: [] })
    expect(after.transactions).toEqual([])
    expect(after.subscribers[0].payments).toEqual([])
    expect(after.subscribers[0].nextCharge).toBe('2026-11-05') // the cycle happened: only the payment is undone
  })

  it('desfazer a confirmação de "A pagar" de ferramenta: volta para "A pagar"', () => {
    const t = { ...tool, autoPaid: false }
    const ctx = makeCtx({ tools: [t] }, '2026-10-06', { settings: on('2026-10-01') })
    const pending = pass(ctx)
    const ops = confirmToolCharge(pending.automationRuns[0], { amount: 2000, date: '2026-10-06' }, { ...ctx, data: pending })
    if (typeof ops === 'string') throw new Error(ops)
    const confirmed = apply(pending, ops)
    const after = apply(confirmed, undoRun(confirmed.automationRuns[0], confirmed, '2026-10-07').ops)
    expect(after.automationRuns[0]).toMatchObject({ status: 'pending', summary: 'Figma: a pagar' })
    expect(after.transactions).toEqual([])
    expect(after.tools[0].nextCharge).toBe('2026-11-05')
  })

  it('meta: desfazer tira só o valor da execução (o que a pessoa guardou à mão fica)', () => {
    const ctx = makeCtx({ financeGoals: [goal], transactions: [cash] }, '2026-10-06', { settings: on('2026-10-01') })
    const data = pass(ctx)
    const manual = { ...data, financeGoals: [{ ...data.financeGoals[0], saved: data.financeGoals[0].saved + 3000 }] }
    const { ops } = undoRun(manual.automationRuns[0], manual, '2026-10-07', 'skipped')
    const after = apply(manual, ops)
    expect(after.financeGoals[0].saved).toBe(3000)
    expect(after.automationRuns[0].status).toBe('skipped')
  })
})
