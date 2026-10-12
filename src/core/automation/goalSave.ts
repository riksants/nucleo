/**
 * Meta → guardar todo mês. On the chosen day, part of the Disponível is reserved for the goal:
 * its saved amount grows; the balance does not change and no movement is created.
 * - calculated: what is missing ÷ reservation days left until the deadline (this one included),
 *   so a short or skipped month is made up by the next ones; fixed: the amount the person set.
 * - never more than the Disponível (in the goal's currency): what was missing is said in `detail`.
 * - stops when the goal is reached, its deadline passed, it is archived or not in the balance.
 * - a goal in a currency without a rate waits (nothing invented).
 */
import type { AutomationRun, Cents, FinanceGoal } from '../../data/types'
import { balanceOf } from '../../data/selectors'
import { formatMoney } from '../../lib/money'
import { withSaved } from '../financeGoals'
import { reserveSummary } from '../reserved'
import { dayInMonth, isDate } from './dates'
import { type AutomationCtx, type BatchOp, type ItemPlan, knownRuns, makeRun, runPut } from './types'

export const goalRunId = (goalId: string, month: string) => `auto-goal-${goalId}-${month}`

const monthOf = (date: string) => date.slice(0, 7)
function nextMonth(month: string): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7))
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Reservation days from `month` until the deadline (inclusive). */
function daysLeft(month: string, day: number, deadline: string): number {
  let n = 0
  for (let m = month; dayInMonth(m, day) <= deadline; m = nextMonth(m)) n++
  return Math.max(n, 1)
}

/** Disponível right now, in the base currency. */
function availableBase(ctx: AutomationCtx): number {
  const balance = balanceOf(ctx.settings, ctx.data.transactions)
  return reserveSummary(ctx.data.financeGoals, balance, ctx.settings.baseCurrency, ctx.convert).available
}

export function shortfallDetail(planned: Cents, reserved: Cents, currency: string): string {
  const m = (c: Cents) => formatMoney(c, currency)
  return `Previsto: ${m(planned)} — reservado: ${m(reserved)} — faltaram ${m(planned - reserved)} por saldo insuficiente.`
}

export function planGoalSaves(ctx: AutomationCtx, since: string): ItemPlan[] {
  const known = knownRuns(ctx.data)
  const base = ctx.settings.baseCurrency
  let available = availableBase(ctx)
  const out: ItemPlan[] = []
  for (const g of ctx.data.financeGoals) {
    const auto = g.autoSave
    if (g.status !== 'active' || !g.inBalance || !auto || !isDate(g.deadline) || !isDate(auto.since)) continue
    const start = auto.since > since ? auto.since : since
    let saved = g.saved
    let history = g.history
    const runs: AutomationRun[] = []
    for (let m = monthOf(start); dayInMonth(m, auto.day) <= ctx.today; m = nextMonth(m)) {
      const date = dayInMonth(m, auto.day)
      if (date < start) continue
      if (date > g.deadline) break
      const missing = g.target - saved
      if (missing <= 0) break
      const id = goalRunId(g.id, m)
      if (known.has(id)) continue
      const planned = Math.min(auto.mode === 'fixed' ? auto.amount : Math.ceil(missing / daysLeft(m, auto.day, g.deadline)), missing)
      if (planned <= 0) break
      const free = ctx.convert(Math.max(available, 0), base, g.currency)
      if (free === null) break // no rate: wait
      const reserved = Math.max(0, Math.min(planned, free))
      const origin = { collection: 'financeGoals' as const, id: g.id, label: g.name }
      const detail = reserved < planned ? shortfallDetail(planned, reserved, g.currency) : undefined
      if (reserved === 0) {
        runs.push(makeRun({ id, automation: 'goalSave', date, summary: `Nada reservado para ${g.name}: saldo disponível insuficiente`, detail, origin, amount: 0, currency: g.currency, created: [], changed: [], status: 'skipped' }, ctx.now))
        continue
      }
      const before = saved
      saved += reserved
      history = withSaved({ history }, saved, date)
      available -= ctx.convert(reserved, g.currency, base) ?? 0
      runs.push(
        makeRun(
          {
            id, automation: 'goalSave', date, summary: `Núcleo reservou ${formatMoney(reserved, g.currency)} para ${g.name}`, detail, origin, amount: reserved, currency: g.currency,
            created: [], changed: [{ collection: 'financeGoals', id: g.id, field: 'saved', before, after: saved }], status: 'done',
          },
          ctx.now,
        ),
      )
    }
    if (!runs.length) continue
    const item: FinanceGoal = { ...g, saved, history }
    const ops: BatchOp[] = saved !== g.saved ? [{ op: 'put', collection: 'financeGoals', item }] : []
    out.push({ runs, ops: [...ops, ...runs.map(runPut)] })
  }
  return out
}

/** "Mudar este mês": the saved amount moves by the difference; never above the Disponível. */
export function changeGoalMonth(run: AutomationRun, amount: Cents, ctx: AutomationCtx): BatchOp[] | string {
  const g = ctx.data.financeGoals.find((x) => x.id === run.origin.id)
  if (!g) return 'Esta meta foi excluída.'
  if (!Number.isFinite(amount) || amount < 0) return 'Digite um valor válido'
  const current = run.status === 'done' ? (run.amount ?? 0) : 0
  const diff = amount - current
  if (diff > 0) {
    const free = ctx.convert(Math.max(availableBase(ctx), 0), ctx.settings.baseCurrency, g.currency)
    if (free === null) return `Sem cotação para ${g.currency} ainda.`
    if (diff > free) return `Maior que o disponível (${formatMoney(free, g.currency)} livres).`
  }
  const saved = Math.max(0, g.saved + diff)
  const item: FinanceGoal = { ...g, saved, history: withSaved(g, saved, ctx.today) }
  const next: AutomationRun = {
    ...run,
    amount,
    currency: g.currency,
    status: amount > 0 ? 'done' : 'skipped',
    summary: amount > 0 ? `Núcleo reservou ${formatMoney(amount, g.currency)} para ${g.name}` : `Nada reservado para ${g.name} neste mês`,
    detail: amount > 0 ? 'Valor deste mês alterado por você.' : 'Mês pulado.',
    changed: [{ collection: 'financeGoals', id: g.id, field: 'saved', before: g.saved - current, after: saved }],
  }
  return [{ op: 'put', collection: 'financeGoals', item }, runPut(next)]
}
