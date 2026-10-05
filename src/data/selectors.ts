import { addMonths, daysBetween, fromDateInput, toDateInput } from '../lib/dates'
import type { Converter } from '../lib/rates'
import type { Cents, Currency, Goal, Project, Settings, Task, Tool, Transaction } from './types'

export function balanceOf(settings: Pick<Settings, 'initialBalance'>, transactions: Transaction[]): Cents {
  return transactions.reduce((sum, t) => sum + t.baseAmount, settings.initialBalance)
}

/** Income and expenses in the base currency. Balance adjustments are not counted as either. */
export function totalsSince(transactions: Transaction[], since: Date | null) {
  let income = 0
  let expense = 0
  for (const t of transactions) {
    if (since && new Date(t.createdAt) < since) continue
    if (t.type === 'in') income += t.baseAmount
    else if (t.type === 'out') expense -= t.baseAmount
  }
  return { income, expense, net: income - expense }
}

export function sortByNewest<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export interface GoalProgress {
  /** Balance expressed in the goal's currency, or null without a rate. */
  balance: Cents | null
  missing: Cents | null
  percent: number | null
  reached: boolean
}

export function goalProgress(goal: Goal, balanceBase: Cents, base: Currency, convert: Converter): GoalProgress {
  const balance = convert(balanceBase, base, goal.currency)
  if (balance === null) return { balance: null, missing: null, percent: null, reached: false }
  const available = Math.max(balance, 0)
  const missing = Math.max(goal.price - available, 0)
  const percent = goal.price > 0 ? Math.min(100, Math.floor((available / goal.price) * 100)) : 100
  return { balance, missing, percent, reached: missing === 0 }
}

export function projectOutstanding(p: Project): Cents {
  return Math.max(p.charged - p.received, 0)
}

export const ACTIVE_PROJECT_STATUSES = new Set<Project['status']>(['notStarted', 'inProgress', 'waitingClient', 'review'])

export function isPaidTool(t: Tool): boolean {
  return (t.status === 'active' || t.status === 'trial') && (t.billing === 'monthly' || t.billing === 'yearly') && t.price > 0
}

/**
 * Moves a stored charge date forward by whole billing cycles until it is today or later.
 * Always counted from the stored date and its day of the month, so a charge on the 31st stays
 * on the last day of short months (31 Jan → 28 Feb → 31 Mar), never drifting to the 3rd.
 */
export function nextChargeDate(t: Tool, today = new Date()): string {
  const d = fromDateInput(t.nextCharge)
  if (!d || !isPaidTool(t)) return t.nextCharge
  const step = t.billing === 'monthly' ? 1 : 12
  let next = d
  for (let n = 1; daysBetween(today, next) < 0; n++) next = addMonths(d, n * step, d.getDate())
  return toDateInput(next)
}

export function upcomingCharges(tools: Tool[], withinDays: number, today = new Date()) {
  return tools
    .filter((t) => isPaidTool(t) && t.nextCharge)
    .map((t) => ({ tool: t, date: nextChargeDate(t, today) }))
    .filter(({ date }) => {
      const d = fromDateInput(date)
      return d !== null && daysBetween(today, d) <= withinDays
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * Adds up money in several currencies into one. `complete` is false when some
 * value could not be converted (no rates), so the UI can say the total is partial.
 */
export function sumIn(items: { cents: Cents; currency: Currency }[], target: Currency, convert: Converter) {
  let total = 0
  let complete = true
  for (const { cents, currency } of items) {
    const v = convert(cents, currency, target)
    if (v === null) complete = false
    else total += v
  }
  return { total, complete }
}

export function toolSpending(tools: Tool[], target: Currency, convert: Converter) {
  const paid = tools.filter(isPaidTool).filter((t) => t.status === 'active')
  const monthly = sumIn(
    paid.map((t) => ({ cents: t.billing === 'monthly' ? t.price : Math.round(t.price / 12), currency: t.currency })),
    target,
    convert,
  )
  const yearly = sumIn(
    paid.map((t) => ({ cents: t.billing === 'monthly' ? t.price * 12 : t.price, currency: t.currency })),
    target,
    convert,
  )
  return { monthly, yearly, count: paid.length }
}

export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalize(query)
  if (!q) return true
  return fields.some((f) => f && normalize(f).includes(q))
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 }

/** Open tasks: dated first (soonest on top), then by priority, then newest. */
export function sortOpenTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    }
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    return a.createdAt < b.createdAt ? 1 : -1
  })
}
