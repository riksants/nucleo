/**
 * Ferramenta → cobrança. On each charge date of an active, paid tool:
 * - "Considerar pago automaticamente" off (default): a "A pagar" run; the expense only exists
 *   once the person confirms (confirmToolCharge).
 * - on: the expense is recorded on the charge date. Without a rate for its currency the tool
 *   waits (no run), so nothing is invented.
 * A one-time charge ("once") happens once and the date doesn't move.
 */
import { instantFor } from '../../data/receipts'
import type { AutomationRun, Cents, Tool, Transaction } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { zoneOf } from '../period'
import { cycleDates, dayOfDate, isDate } from './dates'
import { type AutomationCtx, type BatchOp, type ItemPlan, knownRuns, makeRun, MAX_RUNS_PER_ITEM, runPut } from './types'

export const toolRunId = (toolId: string, date: string) => `auto-tool-${toolId}-${date}`
export const toolTxId = (runId: string) => `tx-${runId}`

/** The expense of a paid charge, or null without a rate. */
function expense(tool: Pick<Tool, 'id' | 'name'>, runId: string, amount: Cents, currency: string, date: string, ctx: AutomationCtx): Transaction | null {
  const base = ctx.convert(amount, currency, ctx.settings.baseCurrency)
  if (base === null) return null
  return {
    id: toolTxId(runId),
    createdAt: instantFor(date, zoneOf(ctx.settings), ctx.now),
    updatedAt: ctx.now.toISOString(),
    type: 'out',
    amount,
    currency,
    baseAmount: -base,
    reason: `${tool.name} · Assinatura`,
    category: 'subscriptions',
    source: { kind: 'tool', parentId: tool.id, paymentId: runId },
  }
}

export function planToolCharges(ctx: AutomationCtx, since: string): ItemPlan[] {
  const known = knownRuns(ctx.data)
  const out: ItemPlan[] = []
  for (const t of ctx.data.tools) {
    if (t.status !== 'active' || t.price <= 0 || !isDate(t.nextCharge)) continue
    if (t.billing !== 'monthly' && t.billing !== 'yearly' && t.billing !== 'once') continue
    const once = t.billing === 'once'
    const anchor = t.chargeDay ?? dayOfDate(t.nextCharge)
    const { due, next } = once
      ? { due: t.nextCharge >= since && t.nextCharge <= ctx.today ? [t.nextCharge] : [], next: t.nextCharge }
      : cycleDates(t.nextCharge, anchor, t.billing === 'monthly' ? 1 : 12, since, ctx.today, MAX_RUNS_PER_ITEM)
    const todo = due.filter((d) => !known.has(toolRunId(t.id, d)))
    // Only a new run moves the date: a charge that was undone (date restored) is not moved again.
    if (!todo.length) continue
    // Considered paid but no rate yet: wait, so the expense is never invented.
    if (t.autoPaid && todo.length && ctx.convert(t.price, t.currency, ctx.settings.baseCurrency) === null) continue
    const money = formatMoney(t.price, t.currency)
    const origin = { collection: 'tools' as const, id: t.id, label: t.name }
    const runs: AutomationRun[] = []
    const extra: BatchOp[] = []
    for (const date of todo) {
      const id = toolRunId(t.id, date)
      const i = due.indexOf(date)
      const after = once ? t.nextCharge : (due[i + 1] ?? next)
      const before = once || i === 0 ? t.nextCharge : date
      const changed = once ? [] : [{ collection: 'tools' as const, id: t.id, field: 'nextCharge', before, after }]
      if (t.autoPaid) {
        const tx = expense(t, id, t.price, t.currency, date, ctx)!
        extra.push({ op: 'put', collection: 'transactions', item: tx })
        runs.push(makeRun({ id, automation: 'toolCharge', date, summary: `Pagamento automático de ${t.name}: ${money}`, origin, amount: t.price, currency: t.currency, created: [{ collection: 'transactions', id: tx.id }], changed, status: 'done' }, ctx.now))
      } else {
        runs.push(makeRun({ id, automation: 'toolCharge', date, summary: `${t.name}: a pagar`, origin, amount: t.price, currency: t.currency, created: [], changed, status: 'pending' }, ctx.now))
      }
    }
    const item: Tool = { ...t, nextCharge: next, chargeDay: anchor }
    const ops: BatchOp[] = once ? [] : [{ op: 'put', collection: 'tools', item }]
    out.push({ runs, ops: [...ops, ...extra, ...runs.map(runPut)] })
  }
  return out.filter((p) => p.ops.length)
}

/** "Confirmar pagamento": the expense with the amount and date the person typed. */
export function confirmToolCharge(run: AutomationRun, input: { amount: Cents; date: string }, ctx: AutomationCtx): BatchOp[] | string {
  const t = ctx.data.tools.find((x) => x.id === run.origin.id)
  if (!input.amount || input.amount <= 0) return 'Digite o valor pago'
  if (!isDate(input.date)) return 'Informe a data do pagamento'
  const currency = run.currency ?? t?.currency ?? ctx.settings.baseCurrency
  const tx = expense({ id: run.origin.id, name: t?.name ?? run.origin.label }, run.id, input.amount, currency, input.date, ctx)
  if (!tx) return `Sem cotação para ${currency} ainda. Atualize a cotação e confirme de novo.`
  const done: AutomationRun = {
    ...run,
    status: 'done',
    amount: input.amount,
    currency,
    summary: `Pagamento confirmado de ${t?.name ?? run.origin.label}: ${formatMoney(input.amount, currency)}`,
    created: [{ collection: 'transactions', id: tx.id }],
  }
  return [{ op: 'put', collection: 'transactions', item: tx }, runPut(done)]
}
