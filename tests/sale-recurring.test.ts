import { describe, expect, it } from 'vitest'
import { planSaleRepeats, saleRepeatId } from '../src/core/automation/saleRecurring'
import type { BatchOp } from '../src/core/automation/types'
import { undoRun } from '../src/core/automation/undo'
import type { Sale } from '../src/data/types'
import { makeCtx, T } from './automation-helpers'

const root = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', createdAt: T, updatedAt: T, clientId: null, clientName: 'Ana', product: 'Aula de inglês', quantity: 1, date: '2026-09-05', total: 20000, currency: 'BRL', dueDate: '2026-09-05',
  payments: [{ id: 'p', date: '2026-09-05', amount: 20000, note: '' }], notes: 'n', recurring: { every: 'month', status: 'active' }, recurNext: '2026-10-05', ...over,
})
const puts = (ops: BatchOp[], c: string) => ops.filter((o): o is Extract<BatchOp, { op: 'put' }> => o.op === 'put' && o.collection === c).map((o) => o.item as Sale)

describe('vendas recorrentes', () => {
  it('gera a cobrança da data, pendente, sem copiar pagamentos; avança a próxima data', () => {
    const [p] = planSaleRepeats(makeCtx({ sales: [root()] }, '2026-10-05'), '2026-10-01')
    const sales = puts(p.ops, 'sales')
    const charge = sales.find((s) => s.id === saleRepeatId('s1', '2026-10-05'))!
    expect(charge).toMatchObject({ date: '2026-10-05', dueDate: '2026-10-05', total: 20000, payments: [], recurOf: 's1', notes: '' })
    expect(sales.find((s) => s.id === 's1')!.recurNext).toBe('2026-11-05')
    expect(p.runs[0]).toMatchObject({ automation: 'saleRecurring', status: 'done' })
  })
  it('não duplica (mesmo id) e nada acontece pausada, encerrada ou antes da data', () => {
    const [p] = planSaleRepeats(makeCtx({ sales: [root()] }, '2026-10-05'), '2026-10-01')
    const after = puts(p.ops, 'sales')
    expect(planSaleRepeats(makeCtx({ sales: after, automationRuns: p.runs }, '2026-10-20'), '2026-10-01')).toEqual([])
    expect(planSaleRepeats(makeCtx({ sales: [root({ recurring: { every: 'month', status: 'paused' } })] }, '2026-10-05'), '2026-10-01')).toEqual([])
    expect(planSaleRepeats(makeCtx({ sales: [root({ recurring: { every: 'month', status: 'ended' } })] }, '2026-10-05'), '2026-10-01')).toEqual([])
    expect(planSaleRepeats(makeCtx({ sales: [root()] }, '2026-10-04'), '2026-10-01')).toEqual([])
  })
  it('desfazer remove a cobrança intocada e devolve a data', () => {
    const [p] = planSaleRepeats(makeCtx({ sales: [root()] }, '2026-10-05'), '2026-10-01')
    const sales = puts(p.ops, 'sales')
    const back = undoRun(p.runs[0], makeCtx({ sales, automationRuns: p.runs }, '2026-10-06').data, '2026-10-06')
    expect(back.ops.some((o) => o.op === 'remove' && o.id === saleRepeatId('s1', '2026-10-05'))).toBe(true)
    expect(puts(back.ops, 'sales').find((s) => s.id === 's1')!.recurNext).toBe('2026-10-05')
  })
})
