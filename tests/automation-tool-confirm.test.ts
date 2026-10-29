import { describe, expect, it } from 'vitest'
import { confirmToolChargeNoExpense, currentToolCycle, payToolNow, planToolCharges, planToolPresumed, toolRunId } from '../src/core/automation/toolCharge'
import type { BatchOp } from '../src/core/automation/types'
import { undoRun } from '../src/core/automation/undo'
import type { AutomationRun, Tool } from '../src/data/types'
import { makeCtx, T } from './automation-helpers'

const tool = (over: Partial<Tool> = {}): Tool => ({
  id: 't1', createdAt: T, updatedAt: T, name: 'Figma', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: '2026-10-20', notes: '', status: 'active', ...over,
})
const puts = (ops: BatchOp[], collection: string) => ops.filter((o): o is Extract<BatchOp, { op: 'put' }> => o.op === 'put' && o.collection === collection).map((o) => o.item)
const pendingOn = (t: Tool, today: string) => planToolCharges(makeCtx({ tools: [t] }, today), '2026-10-01')[0].runs[0]

describe('assinaturas: já paguei, confirmar sem descontar, presumido', () => {
  it('"Já paguei" antes do vencimento: a cobrança do ciclo fica paga e a automação não cobra de novo', () => {
    const t = tool({ nextCharge: '2026-11-05' })
    const ops = payToolNow(t, { amount: 2000, date: '2026-11-02', deduct: true }, makeCtx({ tools: [t] }, '2026-11-02'))
    if (typeof ops === 'string') throw new Error(ops)
    const [run] = puts(ops, 'automationRuns') as AutomationRun[]
    expect(run).toMatchObject({ id: toolRunId('t1', '2026-11-05'), status: 'done', fromPending: true })
    expect(puts(ops, 'transactions')).toHaveLength(1)
    const moved = puts(ops, 'tools')[0] as Tool
    expect(moved.nextCharge).toBe('2026-12-05')
    // On the charge day the automation finds nothing to do for that cycle.
    expect(planToolCharges(makeCtx({ tools: [moved], automationRuns: [run] }, '2026-11-05'), '2026-10-01')).toEqual([])
    // Twice → refused, never duplicated.
    expect(payToolNow(moved, { amount: 2000, date: '2026-11-02', deduct: true }, makeCtx({ tools: [moved], automationRuns: [run] }, '2026-11-02'))).toMatch(/ainda não há o que pagar/)
  })

  it('"Já paguei" sem descontar: nada entra no Financeiro', () => {
    const t = tool({ nextCharge: '2026-11-05' })
    const ops = payToolNow(t, { amount: 2000, date: '2026-11-02', deduct: false }, makeCtx({ tools: [t] }, '2026-11-02'))
    if (typeof ops === 'string') throw new Error(ops)
    expect(puts(ops, 'transactions')).toHaveLength(0)
    expect(puts(ops, 'automationRuns')[0]).toMatchObject({ status: 'done', noExpense: true })
  })

  it('com uma cobrança "A pagar" esperando, "Já paguei" confirma essa mesma', () => {
    const t = tool()
    const run = pendingOn(t, '2026-10-20')
    expect(currentToolCycle(t, makeCtx({ tools: [t], automationRuns: [run] }, '2026-10-22'))).toEqual({ date: '2026-10-20', run })
    const ops = payToolNow(t, { amount: 2000, date: '2026-10-21', deduct: true }, makeCtx({ tools: [t], automationRuns: [run] }, '2026-10-22'))
    if (typeof ops === 'string') throw new Error(ops)
    expect(puts(ops, 'automationRuns')[0]).toMatchObject({ id: run.id, status: 'done' })
    expect(puts(ops, 'tools')).toHaveLength(0)
  })

  it('confirmar sem descontar e desfazer volta para "A pagar"', () => {
    const run = pendingOn(tool(), '2026-10-20')
    const [op] = confirmToolChargeNoExpense(run, makeCtx({ tools: [tool()] }, '2026-10-21'))
    const done = (op as Extract<BatchOp, { op: 'put' }>).item as AutomationRun
    expect(done).toMatchObject({ status: 'done', noExpense: true, created: [] })
    const back = undoRun(done, makeCtx({ tools: [tool()], automationRuns: [done] }, '2026-10-21').data, '2026-10-21')
    expect(puts(back.ops, 'automationRuns')[0]).toMatchObject({ status: 'pending' })
  })

  it('presumido só com autorização da assinatura, um dia depois, e nunca como comprovado', () => {
    const run = pendingOn(tool(), '2026-10-20')
    // default "ask": nothing presumed
    expect(planToolPresumed(makeCtx({ tools: [tool()], automationRuns: [run] }, '2026-10-22'))).toEqual([])
    // "presume": the day after, without touching the balance
    const t = tool({ afterDue: 'presume' })
    expect(planToolPresumed(makeCtx({ tools: [t], automationRuns: [run] }, '2026-10-20'))).toEqual([])
    const [p] = planToolPresumed(makeCtx({ tools: [t], automationRuns: [run] }, '2026-10-21'))
    expect(p.runs[0]).toMatchObject({ status: 'done', presumed: true, noExpense: true, created: [] })
    expect(p.runs[0].summary).toContain('presumido')
    // "presumeDeduct": the expense too
    const [q] = planToolPresumed(makeCtx({ tools: [tool({ afterDue: 'presumeDeduct' })], automationRuns: [run] }, '2026-10-21'))
    expect(puts(q.ops, 'transactions')).toHaveLength(1)
    // the person said "Ainda não paguei": never presumed again
    expect(planToolPresumed(makeCtx({ tools: [t], automationRuns: [{ ...run, presumeDeclined: true }] }, '2026-10-25'))).toEqual([])
  })
})

describe('presumido com saída já lançada', () => {
  it('confirmar mantém a saída (não duplica nem perde a referência)', () => {
    const run = planToolCharges(makeCtx({ tools: [tool()] }, '2026-10-20'), '2026-10-01')[0].runs[0]
    const [p] = planToolPresumed(makeCtx({ tools: [tool({ afterDue: 'presumeDeduct' })], automationRuns: [run] }, '2026-10-21'))
    const presumed = p.runs[0]
    const [op] = confirmToolChargeNoExpense(presumed, makeCtx({ tools: [tool()] }, '2026-10-22'))
    const done = (op as Extract<BatchOp, { op: 'put' }>).item as AutomationRun
    expect(done.created).toEqual(presumed.created)
    expect(done.presumed).toBeUndefined()
    expect(done.summary).toMatch(/confirmado/)
  })
})
