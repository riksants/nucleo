/**
 * Vendas recorrentes → cobranças. On each date of an active repeating sale, a new sale is created with the same
 * buyer, items and total, pending, due that day. It is a charge, never a payment: nothing is marked as received.
 * Fixed ids (same date → same record) so devices and retries never create it twice; undo removes it and puts the
 * date back. Paused or ended repeats create nothing.
 */
import type { AutomationRun, Sale } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { fingerprint } from '../rules/actions'
import { nextRepeat } from '../salesSmart'
import { isDate } from './dates'
import { type AutomationCtx, type BatchOp, type ItemPlan, knownRuns, makeRun, MAX_RUNS_PER_ITEM, runPut } from './types'

export const saleRepeatRunId = (saleId: string, date: string) => `auto-salerec-${saleId}-${date}`
export const saleRepeatId = (saleId: string, date: string) => `sale-rec-${saleId}-${date}`

export function planSaleRepeats(ctx: AutomationCtx, since: string): ItemPlan[] {
  const known = knownRuns(ctx.data)
  const ids = new Set(ctx.data.sales.map((s) => s.id))
  const out: ItemPlan[] = []
  for (const root of ctx.data.sales) {
    if (!root.recurring || root.recurring.status !== 'active' || !isDate(root.recurNext)) continue
    const anchor = Number((root.dueDate || root.date).slice(8, 10)) || Number(root.recurNext.slice(8, 10))
    let date = root.recurNext
    const due: string[] = []
    // Dates before the automation was turned on are skipped (never caught up).
    while (date <= ctx.today && due.length < MAX_RUNS_PER_ITEM) {
      if (date >= since) due.push(date)
      date = nextRepeat(date, root.recurring.every, anchor)
    }
    if (date === root.recurNext) continue
    const runs: AutomationRun[] = []
    const ops: BatchOp[] = []
    for (const d of due) {
      const id = saleRepeatId(root.id, d)
      if (known.has(saleRepeatRunId(root.id, d)) || ids.has(id)) continue
      const charge: Sale = {
        id,
        createdAt: ctx.now.toISOString(),
        updatedAt: ctx.now.toISOString(),
        clientId: root.clientId,
        clientName: root.clientName,
        product: root.product,
        quantity: root.quantity,
        date: d,
        total: root.total,
        currency: root.currency,
        dueDate: d,
        payments: [],
        notes: '',
        ...(root.items ? { items: root.items } : {}),
        ...(root.discount ? { discount: root.discount } : {}),
        ...(root.phone ? { phone: root.phone } : {}),
        recurOf: root.id,
      }
      ops.push({ op: 'put', collection: 'sales', item: charge })
      runs.push(
        makeRun(
          {
            id: saleRepeatRunId(root.id, d),
            automation: 'saleRecurring',
            date: d,
            summary: `Cobrança gerada: ${root.product} — ${formatMoney(root.total, root.currency)} a receber`,
            origin: { collection: 'sales', id: root.id, label: root.product },
            amount: root.total,
            currency: root.currency,
            // Undo removes the charge only while untouched (a payment registered on it keeps it).
            created: [{ collection: 'sales', id, fp: fingerprint(charge) }],
            changed: [{ collection: 'sales', id: root.id, field: 'recurNext', before: root.recurNext, after: date }],
            status: 'done',
          },
          ctx.now,
        ),
      )
    }
    const moved: Sale = { ...root, recurNext: date }
    ops.unshift({ op: 'put', collection: 'sales', item: moved })
    out.push({ runs, ops: [...ops, ...runs.map(runPut)] })
  }
  return out
}
