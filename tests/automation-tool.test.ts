import { describe, expect, it } from 'vitest'
import { confirmToolCharge, planToolCharges, toolRunId, toolTxId } from '../src/core/automation/toolCharge'
import type { AutomationRun, BatchOp } from '../src/core/automation/types'
import type { Tool, Transaction } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { makeCtx, T } from './automation-helpers'

const tool = (over: Partial<Tool> = {}): Tool => ({
  id: 't1', createdAt: T, updatedAt: T, name: 'Figma', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: '2026-10-20', notes: '', status: 'active', ...over,
})
const puts = (ops: BatchOp[], collection: string) => ops.filter((o): o is Extract<BatchOp, { op: 'put' }> => o.op === 'put' && o.collection === collection).map((o) => o.item)

describe('ferramenta → cobrança', () => {
  it('sem "considerar pago": fica "A pagar" e NÃO cria saída', () => {
    const [p] = planToolCharges(makeCtx({ tools: [tool()] }, '2026-10-20'), '2026-10-01')
    expect(p.runs).toHaveLength(1)
    expect(p.runs[0]).toMatchObject({ id: toolRunId('t1', '2026-10-20'), status: 'pending', amount: 2000, currency: 'EUR' })
    expect(puts(p.ops, 'transactions')).toHaveLength(0)
    expect((puts(p.ops, 'tools')[0] as Tool).nextCharge).toBe('2026-11-20')
  })

  it('com "considerar pago": a saída entra na data da cobrança', () => {
    const [p] = planToolCharges(makeCtx({ tools: [tool({ autoPaid: true })] }, '2026-10-21'), '2026-10-01')
    const runId = toolRunId('t1', '2026-10-20')
    const [tx] = puts(p.ops, 'transactions') as Transaction[]
    expect(tx).toMatchObject({ id: toolTxId(runId), type: 'out', amount: 2000, baseAmount: -2000, category: 'subscriptions', source: { kind: 'tool', parentId: 't1', paymentId: runId } })
    expect(tx.createdAt.slice(0, 10)).toBe('2026-10-20')
    expect(p.runs[0]).toMatchObject({ status: 'done', created: [{ collection: 'transactions', id: tx.id }] })
  })

  it('teste, grátis e cancelada não geram nada', () => {
    const ctx = makeCtx({ tools: [tool({ id: 'a', status: 'trial' }), tool({ id: 'b', status: 'free' }), tool({ id: 'c', status: 'cancelled' }), tool({ id: 'd', price: 0 })] }, '2026-10-25')
    expect(planToolCharges(ctx, '2026-10-01')).toEqual([])
  })

  it('cobrança única: uma vez só, sem avançar', () => {
    const t = tool({ billing: 'once', autoPaid: true })
    const [p] = planToolCharges(makeCtx({ tools: [t] }, '2026-10-25'), '2026-10-01')
    expect(p.runs).toHaveLength(1)
    expect(puts(p.ops, 'tools')).toEqual([]) // the tool itself is not changed
    const again = planToolCharges(makeCtx({ tools: [t], automationRuns: p.runs }, '2027-03-01'), '2026-10-01')
    expect(again).toEqual([])
  })

  it('mensal no dia 31 mantém a âncora', () => {
    const [p] = planToolCharges(makeCtx({ tools: [tool({ nextCharge: '2027-01-31' })] }, '2027-02-28'), '2027-01-01')
    expect(p.runs.map((r) => r.date)).toEqual(['2027-01-31', '2027-02-28'])
    expect((puts(p.ops, 'tools')[0] as Tool).nextCharge).toBe('2027-03-31')
  })

  it('anual avança um ano', () => {
    const [p] = planToolCharges(makeCtx({ tools: [tool({ billing: 'yearly' })] }, '2026-10-20'), '2026-10-01')
    expect((puts(p.ops, 'tools')[0] as Tool).nextCharge).toBe('2027-10-20')
  })

  it('"considerar pago" sem cotação: espera (nenhuma execução, nada inventado)', () => {
    const ctx = makeCtx({ tools: [tool({ autoPaid: true, currency: 'USD' })] }, '2026-10-21', { convert: makeConverter({ EUR: 1 }) })
    expect(planToolCharges(ctx, '2026-10-01')).toEqual([])
  })

  it('confirmar pagamento: saída com o valor e a data informados', () => {
    const ctx = makeCtx({ tools: [tool({ nextCharge: '2026-11-20' })] }, '2026-10-22')
    const run = { id: toolRunId('t1', '2026-10-20'), createdAt: T, updatedAt: T, automation: 'toolCharge', date: '2026-10-20', summary: '', origin: { collection: 'tools', id: 't1', label: 'Figma' }, amount: 2000, currency: 'EUR', created: [], changed: [], status: 'pending' } as AutomationRun
    const ops = confirmToolCharge(run, { amount: 2200, date: '2026-10-22' }, ctx)
    if (typeof ops === 'string') throw new Error(ops)
    const [tx] = puts(ops, 'transactions') as Transaction[]
    expect(tx).toMatchObject({ amount: 2200, baseAmount: -2200, type: 'out' })
    expect(puts(ops, 'automationRuns')[0]).toMatchObject({ status: 'done', amount: 2200 })
  })

  it('confirmar sem cotação: explica e não grava', () => {
    const ctx = makeCtx({ tools: [tool({ currency: 'USD' })] }, '2026-10-22', { convert: makeConverter({ EUR: 1 }) })
    const run = { id: 'r', origin: { collection: 'tools', id: 't1', label: 'Figma' }, currency: 'USD', status: 'pending' } as AutomationRun
    expect(typeof confirmToolCharge(run, { amount: 100, date: '2026-10-22' }, ctx)).toBe('string')
  })
})
