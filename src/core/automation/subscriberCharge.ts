/**
 * Assinante → cobrança. On each charge date (active subscribers only):
 * - confirm (default): a "A receber" run is created and the next charge moves one cycle.
 *   No money until the person confirms (confirmSubscriberCharge).
 * - autoPaid (the person's explicit choice): the payment and its income are recorded on the date.
 * The payment id is the run id, and its income id derives from it (data/receipts.ts), so a
 * second device or a repeated pass lands on the same records.
 */
import { receiptTransaction, receiptTxId, subscriberReceipts } from '../../data/receipts'
import type { AutomationRun, Cents, Subscriber } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { cycleDates, dayOfDate, isDate } from './dates'
import { type AutomationCtx, type BatchOp, type ItemPlan, knownRuns, makeRun, MAX_RUNS_PER_ITEM, runPut } from './types'

export const subscriberRunId = (subscriberId: string, date: string) => `auto-sub-${subscriberId}-${date}`

type SubPayment = Subscriber['payments'][number]

const byDate = (a: SubPayment, b: SubPayment) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

/** The income of a charge payment, or null while there is no rate (created later by the reconciler). */
function incomeOps(sub: Subscriber, payment: SubPayment, ctx: AutomationCtx): BatchOp[] {
  const receipt = subscriberReceipts([{ ...sub, payments: [payment] }])[0]
  const tx = receiptTransaction(receipt, { settings: ctx.settings, convert: ctx.convert, now: ctx.now })
  return tx ? [{ op: 'put', collection: 'transactions', item: tx }] : []
}

export function planSubscriberCharges(ctx: AutomationCtx, since: string): ItemPlan[] {
  const known = knownRuns(ctx.data)
  const plans = new Map(ctx.data.subPlans.map((p) => [p.id, p]))
  const out: ItemPlan[] = []
  for (const s of ctx.data.subscribers) {
    const plan = plans.get(s.planId)
    if (s.status !== 'active' || !plan || !isDate(s.nextCharge)) continue
    const anchor = s.chargeDay ?? dayOfDate(s.nextCharge)
    const step = plan.interval === 'monthly' ? 1 : 12
    const { due, next } = cycleDates(s.nextCharge, anchor, step, since, ctx.today, MAX_RUNS_PER_ITEM)
    if (!due.length) continue
    const autoPaid = s.paymentMode === 'autoPaid'
    const payments = [...s.payments]
    const runs: AutomationRun[] = []
    const extra: BatchOp[] = []
    due.forEach((date, i) => {
      const id = subscriberRunId(s.id, date)
      if (known.has(id)) return
      const after = due[i + 1] ?? next
      const before = i === 0 ? s.nextCharge : date
      const money = formatMoney(plan.price, plan.currency)
      const changed = [{ collection: 'subscribers' as const, id: s.id, field: 'nextCharge', before, after }]
      const origin = { collection: 'subscribers' as const, id: s.id, label: s.name }
      if (autoPaid) {
        const payment: SubPayment = { id, date, amount: plan.price, currency: plan.currency, note: '', finance: true, chargeRun: id }
        payments.push(payment)
        const income = incomeOps(s, payment, ctx)
        extra.push(...income)
        runs.push(
          makeRun(
            {
              id, automation: 'subscriberCharge', date, summary: `Pagamento automático de ${s.name}: ${money}`, origin, amount: plan.price, currency: plan.currency,
              created: [{ collection: 'transactions', id: receiptTxId('subscriber', id) }], changed, status: 'done',
            },
            ctx.now,
          ),
        )
      } else {
        runs.push(makeRun({ id, automation: 'subscriberCharge', date, summary: `Cobrança de ${s.name}: a receber`, origin, amount: plan.price, currency: plan.currency, created: [], changed, status: 'pending' }, ctx.now))
      }
    })
    const item: Subscriber = { ...s, nextCharge: next, chargeDay: anchor, payments: payments.sort(byDate) }
    out.push({ runs, ops: [{ op: 'put', collection: 'subscribers', item }, ...extra, ...runs.map(runPut)] })
  }
  return out
}

/** "Confirmar recebimento": the payment (amount and date the person typed) and its income. */
export function confirmSubscriberCharge(run: AutomationRun, input: { amount: Cents; date: string }, ctx: AutomationCtx): BatchOp[] | string {
  const s = ctx.data.subscribers.find((x) => x.id === run.origin.id)
  if (!s) return 'Este assinante foi excluído.'
  if (!input.amount || input.amount <= 0) return 'Digite o valor recebido'
  if (!isDate(input.date)) return 'Informe a data do recebimento'
  const currency = run.currency ?? ctx.data.subPlans.find((p) => p.id === s.planId)?.currency ?? ctx.settings.baseCurrency
  const payment: SubPayment = { id: run.id, date: input.date, amount: input.amount, currency, note: '', finance: true, chargeRun: run.id }
  const item: Subscriber = { ...s, payments: [...s.payments.filter((p) => p.id !== run.id), payment].sort(byDate) }
  const done: AutomationRun = {
    ...run,
    status: 'done',
    amount: input.amount,
    currency,
    summary: `Recebimento confirmado de ${s.name}: ${formatMoney(input.amount, currency)}`,
    created: [{ collection: 'transactions', id: receiptTxId('subscriber', run.id) }],
  }
  return [{ op: 'put', collection: 'subscribers', item }, ...incomeOps(item, payment, ctx), runPut(done)]
}

/** "Não vai pagar" / "Não paguei" / "Pular": the run is closed without any money. */
export function declineRun(run: AutomationRun, detail: string): BatchOp[] {
  return [runPut({ ...run, status: 'skipped', detail })]
}
