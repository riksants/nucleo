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
import { addDaysToDate, zoneOf } from '../period'
import { cycleDates, dayOfDate, isDate, shiftMonths } from './dates'
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
    fromPending: true,
    presumed: undefined,
    noExpense: undefined,
    amount: input.amount,
    currency,
    summary: `Pagamento confirmado de ${t?.name ?? run.origin.label}: ${formatMoney(input.amount, currency)}`,
    created: [{ collection: 'transactions', id: tx.id }],
  }
  return [{ op: 'put', collection: 'transactions', item: tx }, runPut(done)]
}

/** How many days before its date a charge can be marked as paid. */
export const EARLY_DAYS = 10

/** "Confirmar sem descontar": the charge is settled and nothing enters Financeiro. Undo takes it back to "A pagar". */
export function confirmToolChargeNoExpense(run: AutomationRun, ctx: AutomationCtx): BatchOp[] {
  const t = ctx.data.tools.find((x) => x.id === run.origin.id)
  const name = t?.name ?? run.origin.label
  const money = run.amount !== undefined && run.currency ? `: ${formatMoney(run.amount, run.currency)}` : ''
  const { presumed: _p, detail: _d, ...rest } = run
  void _p
  void _d
  // A presumed charge whose expense was already recorded (as authorized): confirming keeps it, just no longer "presumed".
  if (run.status === 'done' && run.created.length) return [runPut({ ...rest, summary: `Pagamento confirmado de ${name}${money}` })]
  return [runPut({ ...rest, status: 'done', fromPending: true, noExpense: true, created: [], summary: `Pago sem descontar do saldo — ${name}${money}` })]
}

/** The charge date "Já paguei" refers to: the oldest one waiting, else the next one from today. */
export function currentToolCycle(tool: Tool, ctx: Pick<AutomationCtx, 'data' | 'today'>): { date: string; run: AutomationRun | null } | null {
  const waiting = ctx.data.automationRuns
    .filter((r) => r.automation === 'toolCharge' && r.origin.id === tool.id && r.status === 'pending')
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0]
  if (waiting) return { date: waiting.date, run: waiting }
  if (tool.status !== 'active' || tool.price <= 0 || !isDate(tool.nextCharge)) return null
  if (tool.billing === 'once') return { date: tool.nextCharge, run: null }
  if (tool.billing !== 'monthly' && tool.billing !== 'yearly') return null
  const anchor = tool.chargeDay ?? dayOfDate(tool.nextCharge)
  const step = tool.billing === 'monthly' ? 1 : 12
  let date = tool.nextCharge
  for (let k = 1; date < ctx.today && k < 600; k++) date = shiftMonths(tool.nextCharge, k * step, anchor)
  return { date, run: null }
}

/**
 * "Já paguei": the same charge the automation would create for this cycle, settled right away — with the expense
 * (`deduct`) or without. The date moves to the next cycle, so the automation never charges this cycle again.
 */
export function payToolNow(tool: Tool, input: { amount: Cents; date: string; deduct: boolean }, ctx: AutomationCtx): BatchOp[] | string {
  const cycle = currentToolCycle(tool, ctx)
  if (!cycle) return 'Esta assinatura não tem cobrança para registrar'
  if (cycle.run) return cycle.run.status === 'pending' ? (input.deduct ? confirmToolCharge(cycle.run, input, ctx) : confirmToolChargeNoExpense(cycle.run, ctx)) : 'Esta cobrança já foi registrada'
  // Paying early is fine, but not a cycle that is still far away (a second tap must not pay next month).
  if (cycle.date > addDaysToDate(ctx.today, EARLY_DAYS)) return `A próxima cobrança é em ${cycle.date.split('-').reverse().join('/')}: ainda não há o que pagar`
  const id = toolRunId(tool.id, cycle.date)
  if (knownRuns(ctx.data).has(id)) return 'Esta cobrança já foi registrada'
  const once = tool.billing === 'once'
  const anchor = tool.chargeDay ?? dayOfDate(tool.nextCharge)
  const after = once ? tool.nextCharge : shiftMonths(cycle.date, tool.billing === 'monthly' ? 1 : 12, anchor)
  const pending = makeRun(
    {
      id,
      automation: 'toolCharge',
      date: cycle.date,
      summary: `${tool.name}: a pagar`,
      origin: { collection: 'tools', id: tool.id, label: tool.name },
      amount: tool.price,
      currency: tool.currency,
      created: [],
      changed: once ? [] : [{ collection: 'tools', id: tool.id, field: 'nextCharge', before: tool.nextCharge, after }],
      status: 'pending',
    },
    ctx.now,
  )
  const settle = input.deduct ? confirmToolCharge(pending, input, ctx) : confirmToolChargeNoExpense(pending, ctx)
  if (typeof settle === 'string') return settle
  const item: Tool = { ...tool, nextCharge: after, chargeDay: anchor }
  const moved: BatchOp[] = once ? [] : [{ op: 'put', collection: 'tools', item }]
  return [...moved, ...settle]
}

/**
 * Tools the person set to "presume" after the due date: a charge still waiting one day after its date becomes
 * "Pagamento presumido" (with the expense only for 'presumeDeduct' and only with a rate). Never for a charge the
 * person already said wasn't paid.
 */
export function planToolPresumed(ctx: AutomationCtx): ItemPlan[] {
  const yesterday = addDaysToDate(ctx.today, -1)
  const out: ItemPlan[] = []
  for (const run of ctx.data.automationRuns) {
    if (run.automation !== 'toolCharge' || run.status !== 'pending' || run.presumeDeclined || run.date > yesterday) continue
    const t = ctx.data.tools.find((x) => x.id === run.origin.id)
    if (!t || (t.afterDue !== 'presume' && t.afterDue !== 'presumeDeduct')) continue
    const amount = run.amount ?? t.price
    const currency = run.currency ?? t.currency
    const tx = t.afterDue === 'presumeDeduct' ? expense(t, run.id, amount, currency, run.date, ctx) : null
    // Deduct allowed but no rate yet: wait (nothing invented).
    if (t.afterDue === 'presumeDeduct' && !tx) continue
    const done: AutomationRun = {
      ...run,
      status: 'done',
      fromPending: true,
      presumed: true,
      summary: `Pagamento presumido — ${t.name}: ${formatMoney(amount, currency)}`,
      detail: `Venceu em ${run.date.split('-').reverse().join('/')} e não foi confirmado.${tx ? ' Descontado do saldo, como você autorizou.' : ' Saldo não alterado.'}`,
      created: tx ? [{ collection: 'transactions', id: tx.id }] : [],
      noExpense: tx ? undefined : true,
    }
    out.push({ runs: [done], ops: [...(tx ? [{ op: 'put' as const, collection: 'transactions' as const, item: tx }] : []), runPut(done)] })
  }
  return out
}
