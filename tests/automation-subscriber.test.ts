import { describe, expect, it } from 'vitest'
import { cycleDates } from '../src/core/automation/dates'
import { confirmSubscriberCharge, declineRun, planSubscriberCharges, subscriberRunId } from '../src/core/automation/subscriberCharge'
import type { AutomationRun, BatchOp } from '../src/core/automation/types'
import { allReceipts, missingReceipts } from '../src/data/receipts'
import type { SubPlan, Subscriber, Transaction } from '../src/data/types'
import { makeCtx, T } from './automation-helpers'

const plan: SubPlan = { id: 'p1', createdAt: T, updatedAt: T, offeringId: 'o1', name: 'Pro', price: 5000, currency: 'EUR', interval: 'monthly' }
const yearly: SubPlan = { ...plan, id: 'p2', price: 48000, interval: 'yearly' }
const sub = (over: Partial<Subscriber> = {}): Subscriber => ({
  id: 's1', createdAt: T, updatedAt: T, offeringId: 'o1', planId: 'p1', name: 'Ana', clientId: null, email: '', startDate: '2026-01-05',
  nextCharge: '2026-10-05', status: 'active', cancelledAt: '', payments: [], notes: '', ...over,
})
const puts = (ops: BatchOp[], collection: string) => ops.filter((o): o is Extract<BatchOp, { op: 'put' }> => o.op === 'put' && o.collection === collection).map((o) => o.item)

describe('datas de cobrança', () => {
  it('mantém o dia âncora: 31 → 28/fev → 31/mar', () => {
    expect(cycleDates('2027-01-31', 31, 1, '2027-01-01', '2027-03-31', 36)).toEqual({ due: ['2027-01-31', '2027-02-28', '2027-03-31'], next: '2027-04-30' })
  })
  it('ano bissexto', () => {
    expect(cycleDates('2028-01-31', 31, 1, '2028-01-01', '2028-02-29', 36).due).toEqual(['2028-01-31', '2028-02-29'])
  })
  it('datas antes de "since" são puladas sem gerar', () => {
    expect(cycleDates('2024-03-05', 5, 1, '2026-10-12', '2026-10-12', 36)).toEqual({ due: [], next: '2026-11-05' })
  })
  it('limite por passada', () => {
    expect(cycleDates('2026-01-01', 1, 1, '2026-01-01', '2026-12-31', 3).due).toHaveLength(3)
  })
})

describe('assinante → cobrança', () => {
  it('modo confirmar (padrão): cria "A receber", avança a próxima cobrança e NÃO cria dinheiro', () => {
    const plans = planSubscriberCharges(makeCtx({ subscribers: [sub()], subPlans: [plan] }, '2026-10-05'), '2026-10-01')
    expect(plans).toHaveLength(1)
    const [p] = plans
    expect(p.runs).toHaveLength(1)
    expect(p.runs[0]).toMatchObject({ id: subscriberRunId('s1', '2026-10-05'), status: 'pending', automation: 'subscriberCharge', amount: 5000, currency: 'EUR', date: '2026-10-05' })
    expect(puts(p.ops, 'transactions')).toHaveLength(0)
    const saved = puts(p.ops, 'subscribers')[0] as Subscriber
    expect(saved.payments).toHaveLength(0)
    expect(saved.nextCharge).toBe('2026-11-05')
  })

  it('considerar pago: registra o pagamento e a entrada (id fixo) na data da cobrança', () => {
    const [p] = planSubscriberCharges(makeCtx({ subscribers: [sub({ paymentMode: 'autoPaid' })], subPlans: [plan] }, '2026-10-06'), '2026-10-01')
    const runId = subscriberRunId('s1', '2026-10-05')
    expect(p.runs[0]).toMatchObject({ id: runId, status: 'done' })
    const saved = puts(p.ops, 'subscribers')[0] as Subscriber
    expect(saved.payments).toEqual([{ id: runId, date: '2026-10-05', amount: 5000, currency: 'EUR', note: '', finance: true, chargeRun: runId }])
    const [tx] = puts(p.ops, 'transactions') as Transaction[]
    expect(tx).toMatchObject({ id: `rcv-subscriber-${runId}`, type: 'in', amount: 5000, baseAmount: 5000, category: 'sales', source: { kind: 'subscriber', parentId: 's1', paymentId: runId } })
    expect(p.runs[0].created).toEqual([{ collection: 'transactions', id: tx.id, fp: expect.any(String) }])
    // the receipt is known, so a missing income (no rate) would be created later by the reconciler
    expect(missingReceipts(allReceipts({ projects: [], sales: [], clients: [], subscribers: [saved], subPlans: [plan] }), [tx])).toEqual([])
  })

  it('atraso: 3 meses sem abrir → 3 cobranças, cada uma com a sua data', () => {
    const [p] = planSubscriberCharges(makeCtx({ subscribers: [sub({ nextCharge: '2026-08-05', paymentMode: 'autoPaid' })], subPlans: [plan] }, '2026-10-10'), '2026-08-01')
    expect(p.runs.map((r) => r.date)).toEqual(['2026-08-05', '2026-09-05', '2026-10-05'])
    expect((puts(p.ops, 'subscribers')[0] as Subscriber).nextCharge).toBe('2026-11-05')
    expect(puts(p.ops, 'transactions')).toHaveLength(3)
  })

  it('plano anual avança um ano', () => {
    const [p] = planSubscriberCharges(makeCtx({ subscribers: [sub({ planId: 'p2' })], subPlans: [yearly] }, '2026-10-05'), '2026-10-01')
    expect((puts(p.ops, 'subscribers')[0] as Subscriber).nextCharge).toBe('2027-10-05')
  })

  it('teste, pausado e cancelado não geram nada', () => {
    const ctx = makeCtx({ subscribers: [sub({ id: 'a', status: 'trial' }), sub({ id: 'b', status: 'paused' }), sub({ id: 'c', status: 'cancelled' })], subPlans: [plan] }, '2026-10-20')
    expect(planSubscriberCharges(ctx, '2026-10-01')).toEqual([])
  })

  it('cobrança antiga (2024) com a automação ligada hoje: nada é lançado antes de hoje', () => {
    const [p] = planSubscriberCharges(makeCtx({ subscribers: [sub({ nextCharge: '2024-03-12', paymentMode: 'autoPaid' })], subPlans: [plan] }, '2026-10-12'), '2026-10-12')
    expect(p.runs.map((r) => r.date)).toEqual(['2026-10-12'])
  })

  it('nada vencido → nada a fazer', () => {
    expect(planSubscriberCharges(makeCtx({ subscribers: [sub()], subPlans: [plan] }, '2026-10-04'), '2026-10-01')).toEqual([])
  })

  it('execução já gravada (qualquer status) nunca é refeita', () => {
    const ctx = makeCtx({ subscribers: [sub()], subPlans: [plan] }, '2026-10-05')
    const [p] = planSubscriberCharges(ctx, '2026-10-01')
    const after = makeCtx({ subscribers: [sub()], subPlans: [plan], automationRuns: [{ ...p.runs[0], status: 'skipped' }] }, '2026-10-05')
    const again = planSubscriberCharges(after, '2026-10-01')
    expect(again.flatMap((x) => x.runs)).toEqual([])
  })

  it('confirmar recebimento: pagamento + entrada com o valor e a data informados', () => {
    const ctx = makeCtx({ subscribers: [sub({ nextCharge: '2026-11-05' })], subPlans: [plan] }, '2026-10-08')
    const run: AutomationRun = {
      id: subscriberRunId('s1', '2026-10-05'), createdAt: T, updatedAt: T, automation: 'subscriberCharge', date: '2026-10-05', summary: 'Cobrança de Ana: a receber',
      origin: { collection: 'subscribers', id: 's1', label: 'Ana' }, amount: 5000, currency: 'EUR', created: [], changed: [], status: 'pending',
    }
    const ops = confirmSubscriberCharge(run, { amount: 4500, date: '2026-10-08' }, ctx)
    if (typeof ops === 'string') throw new Error(ops)
    const saved = puts(ops, 'subscribers')[0] as Subscriber
    expect(saved.payments[0]).toMatchObject({ id: run.id, amount: 4500, date: '2026-10-08', finance: true, chargeRun: run.id })
    const [tx] = puts(ops, 'transactions') as Transaction[]
    expect(tx).toMatchObject({ amount: 4500, type: 'in' })
    expect(puts(ops, 'automationRuns')[0]).toMatchObject({ status: 'done', amount: 4500, created: [{ collection: 'transactions', id: tx.id }] })
  })

  it('não vai pagar: só marca a execução, sem dinheiro', () => {
    const run = { id: 'r', status: 'pending' } as AutomationRun
    const ops = declineRun(run, 'Marcado como não pago')
    expect(ops).toEqual([{ op: 'put', collection: 'automationRuns', item: { ...run, status: 'skipped', detail: 'Marcado como não pago' } }])
  })
})
