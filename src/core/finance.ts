/**
 * Finance numbers for weeks and months, read straight from the movements
 * (the Financeiro section stays the only source; nothing is copied).
 *
 * - A movement belongs to the calendar day it was registered on, in the
 *   person's time zone (same rule the app always had).
 * - Totals use `baseAmount`: the value in the main currency fixed when the
 *   movement was saved. No new conversion, no external rates here.
 * - Balance adjustments change the balance but are neither income nor expense.
 * - Movements are grouped by day once (memoized per list + zone); a week or a
 *   month then only sums its own days.
 */
import type { Currency, DataState, Settings, Transaction } from '../data/types'
import { isPaidTool, nextChargeDate, balanceOf } from '../data/selectors'
import { fromDateInput } from '../lib/dates'
import { wallClock } from '../lib/zoned'
import { fixedCategoryIds } from './financeCategories'
import { dayOf } from './indexes'
import { addDaysToDate, todayIn, zoneOf } from './period'

/** Bump when a finance formula changes (stored with weekly snapshots through METRICS_VERSION). */
export const FINANCE_VERSION = 1

export interface DayMoney {
  income: number
  expense: number
  /** Movements that count as income or expense (adjustments excluded). */
  count: number
  expenseCount: number
  unnecessaryCount: number
  unnecessaryAmount: number
  /** Expense by category id ('' = Sem categoria). */
  byCategory: Record<string, number>
  fixedExpense: number
  /** Movements typed in another currency (their converted value is used). */
  otherCurrency: number
  /** Signed sum of everything that changes the balance (incl. adjustments). */
  balanceDelta: number
}

export interface MoneyTotals extends DayMoney {
  net: number
  variableExpense: number
  /** Days with at least one expense. */
  expenseDays: number
}

export interface FinanceIndex {
  tz: string
  days: Map<string, DayMoney>
}

const blankDay = (): DayMoney => ({ income: 0, expense: 0, count: 0, expenseCount: 0, unnecessaryCount: 0, unnecessaryAmount: 0, byCategory: {}, fixedExpense: 0, otherCurrency: 0, balanceDelta: 0 })

export function dayOfTransaction(t: Pick<Transaction, 'createdAt'>, tz: string): string {
  // Remembered per instant: editing one movement doesn't convert the whole history again.
  return dayOf(t.createdAt, tz)
}

const cache = new WeakMap<Transaction[], Map<string, FinanceIndex>>()

export function financeIndex(transactions: Transaction[], settings: Pick<Settings, 'timeZone' | 'financeCategories' | 'baseCurrency'>): FinanceIndex {
  const tz = zoneOf(settings)
  const fixed = fixedCategoryIds(settings)
  const key = `${tz}|${settings.baseCurrency}|${[...fixed].sort().join(',')}`
  let perList = cache.get(transactions)
  const hit = perList?.get(key)
  if (hit) return hit
  const days = new Map<string, DayMoney>()
  for (const t of transactions) {
    const date = dayOfTransaction(t, tz)
    let d = days.get(date)
    if (!d) days.set(date, (d = blankDay()))
    d.balanceDelta += t.baseAmount
    if (t.type === 'adjust') continue
    d.count++
    if (t.currency !== settings.baseCurrency) d.otherCurrency++
    if (t.type === 'in') d.income += t.baseAmount
    else {
      const v = -t.baseAmount
      d.expense += v
      d.expenseCount++
      const cat = t.category ?? ''
      d.byCategory[cat] = (d.byCategory[cat] ?? 0) + v
      if (t.category && fixed.has(t.category)) d.fixedExpense += v
      if (t.unnecessary) {
        d.unnecessaryCount++
        d.unnecessaryAmount += v
      }
    }
  }
  const index = { tz, days }
  if (!perList) cache.set(transactions, (perList = new Map()))
  perList.set(key, index)
  return index
}

/** Sum of the days from → to (inclusive). Iterates the range, not the history. */
export function totalsBetween(index: FinanceIndex, from: string, to: string): MoneyTotals {
  const out: MoneyTotals = { ...blankDay(), net: 0, variableExpense: 0, expenseDays: 0 }
  if (to < from) return out
  // Short ranges walk the calendar; long ones walk only the days that have movements.
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000
  const dates = span <= index.days.size ? walk(from, to) : [...index.days.keys()].filter((d) => d >= from && d <= to)
  for (const date of dates) {
    const d = index.days.get(date)
    if (!d) continue
    out.income += d.income
    out.expense += d.expense
    out.count += d.count
    out.expenseCount += d.expenseCount
    out.unnecessaryCount += d.unnecessaryCount
    out.unnecessaryAmount += d.unnecessaryAmount
    out.fixedExpense += d.fixedExpense
    out.otherCurrency += d.otherCurrency
    out.balanceDelta += d.balanceDelta
    if (d.expenseCount) out.expenseDays++
    for (const [k, v] of Object.entries(d.byCategory)) out.byCategory[k] = (out.byCategory[k] ?? 0) + v
  }
  out.net = out.income - out.expense
  out.variableExpense = out.expense - out.fixedExpense
  return out
}

function walk(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from, guard = 0; d <= to && guard < 400; d = addDaysToDate(d, 1), guard++) out.push(d)
  return out
}

/** Expense categories, biggest first. "Sem categoria" is listed but never called the biggest category. */
export function categoryRanking(t: Pick<MoneyTotals, 'byCategory'>): { category: string; amount: number }[] {
  return Object.entries(t.byCategory)
    .filter(([, v]) => v > 0)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category))
}

export function topCategory(t: Pick<MoneyTotals, 'byCategory'>): { category: string; amount: number } | null {
  return categoryRanking(t).find((c) => c.category !== '') ?? null
}

/* ------------------------------- months ------------------------------- */

export type MonthId = string // "YYYY-MM"

export const monthOf = (date: string): MonthId => date.slice(0, 7)

export function monthBounds(month: MonthId): { from: string; to: string; days: number } {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, days }
}

export function addMonthsTo(month: MonthId, n: number): MonthId {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const monthLabel = (month: MonthId) => MONTHS[Number(month.slice(5, 7)) - 1]

/** Day the person started using the app (opening balance date), in their zone. */
export function startDay(settings: Pick<Settings, 'startedAt' | 'timeZone'>): string {
  return settings.startedAt ? wallClock(new Date(settings.startedAt), zoneOf(settings)).date : '0000-01-01'
}

/** Balance at the start of a day: initial balance + everything registered before it. */
export function balanceBefore(index: FinanceIndex, settings: Pick<Settings, 'initialBalance'>, date: string): number {
  let sum = settings.initialBalance
  for (const [d, v] of index.days) if (d < date) sum += v.balanceDelta
  return sum
}

export interface MonthComparison {
  /** Same period of both months (current month in progress) or full months. */
  partial: boolean
  /** Last day compared (day of month) when partial. */
  uptoDay: number
  previous: MoneyTotals
  expenseChangePct: number | null
  incomeChangePct: number | null
  netDiff: number
}

export interface MonthSummary {
  month: MonthId
  from: string
  to: string
  /** The month is still going (today is inside it). */
  inProgress: boolean
  /** The person started using the app inside this month (opening = initial balance). */
  startedInMonth: boolean
  opening: number
  closing: number
  totals: MoneyTotals
  categories: { category: string; amount: number }[]
  comparison: MonthComparison | null
  /** Why there is no comparison, in plain words (null when there is one). */
  comparisonNote: string | null
}

const changePct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null)

export function monthSummary(data: Pick<DataState, 'transactions'>, settings: Settings, month: MonthId, now = new Date()): MonthSummary {
  const index = financeIndex(data.transactions, settings)
  const today = todayIn(index.tz, now)
  const { from, to, days } = monthBounds(month)
  const inProgress = today >= from && today <= to
  const end = inProgress ? today : to
  const started = startDay(settings)
  const totals = totalsBetween(index, from, end)
  const opening = balanceBefore(index, settings, from)
  const closing = opening + totals.balanceDelta

  // Compare only equivalent periods, and only when the app was already in use
  // for the whole previous period (otherwise the numbers are not comparable).
  const prev = addMonthsTo(month, -1)
  const pb = monthBounds(prev)
  const uptoDay = inProgress ? Number(today.slice(8, 10)) : days
  const prevEnd = inProgress ? `${prev}-${String(Math.min(uptoDay, pb.days)).padStart(2, '0')}` : pb.to
  let comparison: MonthComparison | null = null
  let comparisonNote: string | null = null
  if (started > pb.from) comparisonNote = started > to ? null : `Sem comparação: você começou a usar o NÚCLEO depois do início de ${monthLabel(prev)}.`
  else {
    const previous = totalsBetween(index, pb.from, prevEnd)
    if (previous.count === 0) comparisonNote = inProgress ? `Sem movimentações no mesmo período de ${monthLabel(prev)} (até o dia ${uptoDay}) para comparar.` : `Sem movimentações em ${monthLabel(prev)} para comparar.`
    else
      comparison = {
        partial: inProgress,
        uptoDay,
        previous,
        expenseChangePct: changePct(totals.expense, previous.expense),
        incomeChangePct: changePct(totals.income, previous.income),
        netDiff: totals.net - previous.net,
      }
  }
  return { month, from, to, inProgress, startedInMonth: started > from && started <= to, opening, closing, totals, categories: categoryRanking(totals), comparison, comparisonNote }
}

/* ------------------------------- weeks ------------------------------- */

export interface WeekMoney {
  totals: MoneyTotals
  /** Days of the week considered (up to today for the current week). */
  daysElapsed: number
  dailyAverage: number
  top: { category: string; amount: number } | null
  /** Same days of the previous week (Mon → same weekday when in progress). */
  previous: MoneyTotals | null
  expenseDiff: number | null
}

export function weekMoney(data: Pick<DataState, 'transactions'>, settings: Settings, week: string, now = new Date()): WeekMoney {
  const index = financeIndex(data.transactions, settings)
  const today = todayIn(index.tz, now)
  const sunday = addDaysToDate(week, 6)
  const end = today < sunday ? today : sunday
  const daysElapsed = end < week ? 0 : Math.round((Date.parse(end) - Date.parse(week)) / 86_400_000) + 1
  const totals = totalsBetween(index, week, end)
  const prevFrom = addDaysToDate(week, -7)
  const started = startDay(settings)
  const previous = started <= prevFrom ? totalsBetween(index, prevFrom, addDaysToDate(end, -7)) : null
  return {
    totals,
    daysElapsed,
    dailyAverage: daysElapsed ? Math.round(totals.expense / daysElapsed) : 0,
    top: topCategory(totals),
    previous: previous && previous.count > 0 ? previous : null,
    expenseDiff: previous && previous.count > 0 && totals.count > 0 ? totals.expense - previous.expense : null,
  }
}

/* ------------------------------- forecast ------------------------------- */

/** Minimum data before showing an end-of-month estimate. */
export const FORECAST_MIN = { days: 7, expenses: 5, expenseDays: 3 }

export type Forecast =
  | { ready: false; daysElapsed: number; expenses: number; expenseDays: number }
  | {
      ready: true
      estimate: number
      balance: number
      dailyVariable: number
      daysLeft: number
      /** Paid tools charging after today until the month ends, in the main currency. */
      upcoming: number
      upcomingCount: number
      /** Tool charges in another currency: listed, not summed (no conversion here). */
      upcomingOther: { name: string; amount: number; currency: Currency; date: string }[]
    }

/**
 * Estimate = current balance − (variable spending pace × days left) − tool
 * charges still to come this month. Fixed categories are not extrapolated;
 * new income is not projected (salaries have no daily pace).
 */
export function monthForecast(data: Pick<DataState, 'transactions' | 'tools'>, settings: Settings, now = new Date()): Forecast {
  const index = financeIndex(data.transactions, settings)
  const today = todayIn(index.tz, now)
  const month = monthOf(today)
  const { from, to } = monthBounds(month)
  const started = startDay(settings)
  const begin = started > from ? started : from
  const daysElapsed = Math.max(0, Math.round((Date.parse(today) - Date.parse(begin)) / 86_400_000) + 1)
  const t = totalsBetween(index, from, today)
  if (daysElapsed < FORECAST_MIN.days || t.expenseCount < FORECAST_MIN.expenses || t.expenseDays < FORECAST_MIN.expenseDays) {
    return { ready: false, daysElapsed, expenses: t.expenseCount, expenseDays: t.expenseDays }
  }
  const daysLeft = Math.round((Date.parse(to) - Date.parse(today)) / 86_400_000)
  const dailyVariable = t.variableExpense / daysElapsed
  let upcoming = 0
  let upcomingCount = 0
  const upcomingOther: { name: string; amount: number; currency: Currency; date: string }[] = []
  const anchor = fromDateInput(today) ?? new Date(now)
  for (const tool of data.tools) {
    if (!isPaidTool(tool)) continue
    const date = nextChargeDate(tool, anchor)
    if (!date || date <= today || date > to) continue
    if (tool.currency === settings.baseCurrency) {
      upcoming += tool.price
      upcomingCount++
    } else upcomingOther.push({ name: tool.name, amount: tool.price, currency: tool.currency, date })
  }
  const balance = balanceOf(settings, data.transactions)
  return { ready: true, estimate: Math.round(balance - dailyVariable * daysLeft - upcoming), balance, dailyVariable: Math.round(dailyVariable), daysLeft, upcoming, upcomingCount, upcomingOther }
}
