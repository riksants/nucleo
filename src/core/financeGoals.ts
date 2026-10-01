/**
 * Finance goals with a deadline ("R$ 5.000 até dezembro"). The saved amount is
 * what the person registers — never inferred from the balance. Language stays
 * neutral: the app says what would be needed, not that someone is "late".
 */
import type { Currency, FinanceGoal } from '../data/types'
import { addDaysToDate } from './period'

const DAY = 86_400_000
const AVG_MONTH_DAYS = 30.4375
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

/** Keeps the first point (baseline) and the most recent ones. */
const HISTORY_MAX = 400

/** Saved value at the end of `date`. Before the first record, the baseline (the value it was created with). */
export function savedOn(goal: Pick<FinanceGoal, 'history' | 'saved'>, date: string): number {
  const h = goal.history ?? []
  if (!h.length) return goal.saved
  let value = h[0].saved
  for (const p of h) {
    if (p.date > date) break
    value = p.saved
  }
  return value
}

/**
 * History of a new goal: the amount it starts with is the starting point, dated
 * the day before, so money added on the creation day still counts as saved.
 */
export function startHistory(saved: number, today: string): FinanceGoal['history'] {
  return [{ date: addDaysToDate(today, -1), saved }]
}

/** New history after setting the saved value on `date` (one point per day). */
export function withSaved(goal: Pick<FinanceGoal, 'history'> | null, saved: number, date: string): FinanceGoal['history'] {
  const h = [...(goal?.history ?? [])].filter((p) => p.date !== date)
  h.push({ date, saved })
  h.sort((a, b) => (a.date < b.date ? -1 : 1))
  return h.length > HISTORY_MAX ? [h[0], ...h.slice(h.length - HISTORY_MAX + 1)] : h
}

/**
 * Amount registered as saved between `from` and `to` (inclusive), only for
 * goals in `currency` (amounts of other currencies are never summed together).
 * Withdrawals count negative. Creating a goal with an amount already saved is
 * a starting point, not money saved that week.
 */
export function savedBetween(goals: FinanceGoal[], currency: Currency, from: string, to: string): number | null {
  const same = goals.filter((g) => g.currency === currency)
  if (!same.length) return null
  const before = addDaysToDate(from, -1)
  return same.reduce((sum, g) => sum + savedOn(g, to) - savedOn(g, before), 0)
}

export interface GoalPlan {
  missing: number
  percent: number
  reached: boolean
  daysLeft: number
  /** Deadline is today or already passed. */
  due: boolean
  perMonth: number | null
  perWeek: number | null
  /** On the straight line from where it started to the target by the deadline. null = too early to say. */
  onPace: boolean | null
}

export function goalPlan(goal: FinanceGoal, today: string): GoalPlan {
  const target = Math.max(goal.target, 0)
  const missing = Math.max(target - goal.saved, 0)
  const percent = target ? Math.min(100, Math.floor((Math.max(goal.saved, 0) / target) * 100)) : 100
  const reached = missing === 0
  const daysLeft = daysBetween(today, goal.deadline)
  const due = daysLeft <= 0
  let perMonth: number | null = null
  let perWeek: number | null = null
  if (!reached && !due) {
    perWeek = Math.ceil(missing / Math.max(1, daysLeft / 7))
    perMonth = daysLeft >= AVG_MONTH_DAYS ? Math.ceil(missing / (daysLeft / AVG_MONTH_DAYS)) : null
  }
  let onPace: boolean | null = null
  const startDate = goal.history?.[0]?.date ?? goal.createdAt.slice(0, 10)
  const total = daysBetween(startDate, goal.deadline)
  const elapsed = daysBetween(startDate, today)
  if (!reached && total > 0 && elapsed >= 7 && !due) {
    const start = goal.history?.[0]?.saved ?? 0
    const expected = start + ((target - start) * elapsed) / total
    onPace = goal.saved >= expected
  }
  return { missing, percent, reached, daysLeft, due, perMonth, perWeek, onPace }
}
