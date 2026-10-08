/**
 * "Como alcançar esta meta": practical scenarios for a finance goal with a deadline — how much to save per
 * period, how many sales at a few prices, how many people paying a monthly fee, what a service would cost.
 * Everything is computed on what is STILL MISSING (never the full target) and the time left until the
 * deadline. Prices and head counts are not fixed lists: they come from what is needed per period, rounded to
 * friendly numbers, so a € 300 goal and a € 200.000 goal both get scenarios that make sense.
 * Amounts are whole currency units, always rounded UP (a scenario never falls short of the goal).
 * To add a new kind of scenario, add a field to `GoalStrategies` and compute it in `goalStrategies`.
 */
import type { Cents } from '../data/types'

const DAY = 86_400_000
const AVG_MONTH_DAYS = 30.4375
const UNIT = 100 // cents in one currency unit

/** Unit the "per …" counts are expressed in: months when there is at least a month left, else weeks, else the whole time. */
export type StrategyPeriod = 'month' | 'week' | 'total'

export interface SaleScenario {
  price: Cents
  total: number
  /** Sales per period (null when the period is 'total'). */
  perPeriod: number | null
}

export interface RecurringScenario {
  people: number
  fee: Cents
}

export interface ServiceScenario {
  /** How many services per period (or in total). */
  count: number
  price: Cents
}

export interface GoalStrategies {
  missing: Cents
  daysLeft: number
  period: StrategyPeriod
  /** Whole periods until the deadline (months or weeks); 1 when the period is 'total'. */
  periods: number
  save: { perMonth: Cents | null; perWeek: Cents | null; perDay: Cents }
  sales: SaleScenario[]
  /** Only with at least 2 months left (a single payment is just a sale). */
  recurring: RecurringScenario[]
  /** Monthly fees are paid for this many months. */
  recurringMonths: number
  services: ServiceScenario[]
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

/** Up to the next whole currency unit. */
const ceilUnit = (cents: number) => Math.max(UNIT, Math.ceil(cents / UNIT) * UNIT)

/** Up to a friendly price: steps of 1 below 100, 10 below 1.000, 100 below 10.000… (e.g. 751 → 760, 1.501 → 1.600). */
export function niceCeil(cents: number): Cents {
  const units = Math.max(1, cents / UNIT)
  const step = units < 100 ? 1 : 10 ** (Math.floor(Math.log10(units)) - 1)
  return Math.ceil(units / step) * step * UNIT
}

/** Nearest number of the 1-2-5 series (10, 20, 50, 100, 200, 500…), for example prices. */
export function nice125(cents: number): Cents {
  const units = Math.max(1, cents / UNIT)
  const exp = Math.floor(Math.log10(units))
  let best = 1
  for (const k of [exp - 1, exp, exp + 1]) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** k
      if (v >= 1 && Math.abs(Math.log(v / units)) < Math.abs(Math.log(best / units))) best = v
    }
  }
  return best * UNIT
}

/** Head counts that read naturally for a subscription. */
const PEOPLE = [3, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]
/** Target sales per period for the three example prices (many cheap → few expensive). */
const SALES_PER_PERIOD = [20, 5, 2]
const SERVICES_PER_PERIOD = [1, 2, 4]
/** A "comfortable" monthly fee, in currency units (only to prefer some head counts over others). */
const FEE_RANGE = [10, 300]

/** Picks `n` items spread over the list (first, middle, last…). */
function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))])
}

/**
 * Scenarios for `missing` cents until `deadline` (both "YYYY-MM-DD", `today` in the user's time zone).
 * null when there is nothing to plan: the goal is reached or the deadline is today/past.
 */
export function goalStrategies(missing: Cents, today: string, deadline: string): GoalStrategies | null {
  const daysLeft = daysBetween(today, deadline)
  if (missing <= 0 || daysLeft <= 0) return null

  // Whole periods, with a few days of tolerance (152 days → 5 months, not 4).
  const months = Math.floor(daysLeft / AVG_MONTH_DAYS + 0.1)
  const weeks = Math.floor(daysLeft / 7 + 0.15)
  const period: StrategyPeriod = months >= 1 ? 'month' : weeks >= 1 ? 'week' : 'total'
  const periods = period === 'month' ? months : period === 'week' ? weeks : 1
  const perPeriod = missing / periods

  // Saving uses the exact time left (same math as the goal's "seriam necessários…" sentence, so the numbers
  // match); counts of sales/services/people use whole periods, which is how people think about them.
  const save = {
    perMonth: months >= 1 ? ceilUnit(missing / Math.max(1, daysLeft / AVG_MONTH_DAYS)) : null,
    perWeek: weeks >= 1 ? ceilUnit(missing / Math.max(1, daysLeft / 7)) : null,
    perDay: ceilUnit(missing / daysLeft),
  }

  // Sales: example prices that give about 20, 5 and 2 sales per period.
  const prices = [...new Set(SALES_PER_PERIOD.map((k) => nice125(perPeriod / k)))].filter((p) => p < missing || p === nice125(missing)).sort((a, b) => a - b)
  const sales = prices.map((price) => {
    const total = Math.ceil(missing / price)
    return { price, total, perPeriod: period === 'total' ? null : Math.ceil(total / periods) }
  })

  // Recurring: N people paying a monthly fee for the months left.
  const recurringMonths = months
  let recurring: RecurringScenario[] = []
  if (months >= 2) {
    const all = PEOPLE.map((people) => ({ people, fee: niceCeil(missing / (people * months)) })).filter((s) => s.fee >= 5 * UNIT && s.fee * s.people * months >= missing && s.fee < missing / months)
    const comfortable = all.filter((s) => s.fee >= FEE_RANGE[0] * UNIT && s.fee <= FEE_RANGE[1] * UNIT)
    recurring = spread(comfortable.length >= 3 ? comfortable : all, 3)
  }

  // Services: 1, 2 or 4 per period — at what price.
  const services = SERVICES_PER_PERIOD.map((count) => ({ count, price: niceCeil(perPeriod / count) })).filter((s, i, list) => i === 0 || s.price < list[i - 1].price)

  return { missing, daysLeft, period, periods, save, sales, recurring, recurringMonths, services }
}
