import { addMonths, daysBetween, fromDateInput, toDateInput } from '../lib/dates'
import type { Converter } from '../lib/rates'
import type { BillingInterval, Cents, Currency, SubPlan, Subscriber, SubscriberStatus } from './types'

export const SUBSCRIBER_STATUS_LABEL: Record<SubscriberStatus, string> = {
  active: 'Ativa',
  trial: 'Teste',
  paused: 'Pausada',
  cancelled: 'Cancelada',
}

export const INTERVAL_LABEL: Record<BillingInterval, string> = { monthly: 'Mensal', yearly: 'Anual' }
export const PER_INTERVAL: Record<BillingInterval, string> = { monthly: '/mês', yearly: '/ano' }

/** Only paying, active subscriptions count for projections. Trials, paused and cancelled don't. */
export function isPaying(s: Pick<Subscriber, 'status'>): boolean {
  return s.status === 'active'
}

export interface CurrencyProjection {
  currency: Currency
  /** Sum of monthly plans, exact. */
  monthlyPlans: Cents
  /** Yearly plans divided by 12: an equivalent for comparison, not money arriving each month. */
  yearlyAsMonthly: Cents
  /** Monthly plans × 12 (estimate) + yearly plans (exact). */
  yearly: Cents
  active: number
}

/**
 * Expected revenue per currency. Never adds different currencies together:
 * use `convertProjection` for an explicit, labeled conversion.
 */
export function projectRevenue(subscribers: Subscriber[], plans: SubPlan[]): CurrencyProjection[] {
  const byId = new Map(plans.map((p) => [p.id, p]))
  const out = new Map<Currency, CurrencyProjection>()
  for (const s of subscribers) {
    if (!isPaying(s)) continue
    const plan = byId.get(s.planId)
    if (!plan) continue
    const row = out.get(plan.currency) ?? { currency: plan.currency, monthlyPlans: 0, yearlyAsMonthly: 0, yearly: 0, active: 0 }
    row.active++
    if (plan.interval === 'monthly') {
      row.monthlyPlans += plan.price
      row.yearly += plan.price * 12
    } else {
      row.yearlyAsMonthly += Math.round(plan.price / 12)
      row.yearly += plan.price
    }
    out.set(plan.currency, row)
  }
  return [...out.values()].sort((a, b) => b.yearly - a.yearly)
}

/** Money actually received, per currency, since a date ("" = all time). */
export function receivedByCurrency(subscribers: Subscriber[], since = ''): Map<Currency, Cents> {
  const out = new Map<Currency, Cents>()
  for (const s of subscribers) {
    for (const p of s.payments) {
      if (since && p.date < since) continue
      out.set(p.currency, (out.get(p.currency) ?? 0) + p.amount)
    }
  }
  return out
}

/** Converts every currency into one, saying when it is incomplete (missing rate). */
export function convertTotals(values: { currency: Currency; cents: Cents }[], target: Currency, convert: Converter) {
  let total = 0
  const missing: Currency[] = []
  for (const v of values) {
    const c = convert(v.cents, v.currency, target)
    if (c === null) missing.push(v.currency)
    else total += c
  }
  return { total, missing }
}

/** Next charge rolled forward by whole cycles (a stored past date means "already charged"). */
export function nextChargeOf(s: Subscriber, plan: SubPlan | undefined, today = new Date()): string {
  const d = fromDateInput(s.nextCharge)
  if (!d || !plan || s.status === 'cancelled' || s.status === 'paused') return s.status === 'cancelled' ? '' : s.nextCharge
  const anchor = d.getDate()
  let next = d
  for (let n = 1; daysBetween(today, next) < 0; n++) next = addMonths(d, plan.interval === 'monthly' ? n : n * 12, anchor)
  return toDateInput(next)
}

/** After recording a payment for the current cycle, the next charge moves one cycle ahead. */
export function advanceCharge(nextCharge: string, interval: BillingInterval): string {
  const d = fromDateInput(nextCharge)
  if (!d) return nextCharge
  return toDateInput(addMonths(d, interval === 'monthly' ? 1 : 12))
}
