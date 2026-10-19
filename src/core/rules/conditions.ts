/**
 * Does a rule answer this event? The trigger must match, then every condition (AND). A condition
 * with several values holds when the event has any of them (OR inside one condition).
 * A value condition only matches events in its own currency: €500 is never compared with R$500.
 */
import type { Rule, RuleCondition, RunConversion, Weekday } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { effectiveRates } from '../../lib/rates'
import { weekdayOfDate } from '../period'
import { triggerInfo } from './catalog'
import { normalize } from './text'
import type { RuleCtx, RuleEvent } from './types'

export function triggerMatches(rule: Pick<Rule, 'trigger'>, ev: RuleEvent): boolean {
  const t = triggerInfo(rule.trigger.kind)
  if (t.scheduled || t.base !== ev.kind) return false
  if (t.origin && ev.moneyOrigin !== t.origin) return false
  if (t.status && ev.status !== t.status) return false
  return true
}

/** true / false, or null when it could not be checked (a conversion without a rate), with why. */
export interface ConditionCheck {
  ok: boolean | null
  reason?: string
  conversion?: RunConversion
}

/** The rate behind a conversion, as the history will show it. */
export function conversionOf(ctx: Pick<RuleCtx, 'settings'>, from: string, amount: number, to: string, converted: number): RunConversion {
  const table = effectiveRates(ctx.settings)
  const a = table?.[from]
  const b = table?.[to]
  const rate = a && b ? b / a : amount ? converted / amount : 0
  const manual = Boolean(ctx.settings.manualRates?.[from] || ctx.settings.manualRates?.[to])
  return { from, amount, to, converted, rate: Math.round(rate * 1e6) / 1e6, rateAt: manual ? 'manual' : (ctx.settings.rates?.fetchedAt ?? 'desconhecido') }
}

const compare = (c: Extract<RuleCondition, { field: 'amount' }>, v: number) => {
  if (c.op === 'gt') return v > c.value
  if (c.op === 'lt') return v < c.value
  const lo = Math.min(c.value, c.value2 ?? c.value)
  const hi = Math.max(c.value, c.value2 ?? c.value)
  return v >= lo && v <= hi
}

/**
 * A condition on one event. A value condition with `compare: 'base'` converts other currencies with
 * the app's rates (the same as Financeiro); without a rate the answer is "could not check" (null).
 */
export function checkCondition(c: RuleCondition, ev: RuleEvent, ctx?: Pick<RuleCtx, 'settings' | 'convert'>): ConditionCheck {
  if (c.field !== 'amount') return { ok: conditionHolds(c, ev) }
  if (ev.amount === undefined || !ev.currency) return { ok: false }
  if (ev.currency === c.currency) return { ok: compare(c, ev.amount) }
  if (c.compare !== 'base' || !ctx) return { ok: false }
  const converted = ctx.convert(ev.amount, ev.currency, c.currency)
  if (converted === null) return { ok: null, reason: `sem cotação de ${ev.currency} para comparar com ${formatMoney(c.value, c.currency)}` }
  return { ok: compare(c, converted), conversion: conversionOf(ctx, ev.currency, ev.amount, c.currency, converted) }
}

/** All conditions: any false → false; else any unchecked → null (with the reason); else true. */
export function checkConditions(conditions: RuleCondition[], ev: RuleEvent, ctx?: Pick<RuleCtx, 'settings' | 'convert'>): ConditionCheck & { each: ConditionCheck[] } {
  const each = conditions.map((c) => checkCondition(c, ev, ctx))
  const conversion = each.find((x) => x.conversion)?.conversion
  if (each.some((x) => x.ok === false)) return { ok: false, each, conversion }
  const unknown = each.find((x) => x.ok === null)
  if (unknown) return { ok: null, reason: unknown.reason, each, conversion }
  return { ok: true, each, conversion }
}

const has = (values: readonly string[], v: string | null | undefined) => v != null && values.includes(v)

export function conditionHolds(c: RuleCondition, ev: RuleEvent): boolean {
  switch (c.field) {
    case 'amount':
      // Same currency only (a conversion needs the rates: checkCondition).
      return ev.amount !== undefined && ev.currency === c.currency && compare(c, ev.amount)
    case 'currency':
      return has(c.values, ev.currency)
    case 'category':
      return has(c.values, ev.category)
    case 'origin':
      return has(c.values, ev.moneyOrigin)
    case 'client':
      return has(c.values, ev.clientId)
    case 'project':
      return has(c.values, ev.projectId)
    case 'text': {
      const q = normalize(c.contains)
      return !q || normalize(ev.text ?? '').includes(q)
    }
    case 'status':
      return has(c.values, ev.status)
    case 'statusBefore':
      return has(c.values, ev.statusBefore)
    case 'priority':
      return has(c.values, ev.priority)
    case 'goal':
      return has(c.values, ev.goalId)
    case 'weekday':
      return (c.values as Weekday[]).includes(weekdayOfDate(ev.date))
  }
}

export const conditionsHold = (conditions: RuleCondition[], ev: RuleEvent) => conditions.every((c) => conditionHolds(c, ev))

export function matches(rule: Pick<Rule, 'trigger' | 'conditions'>, ev: RuleEvent): boolean {
  return triggerMatches(rule, ev) && conditionsHold(rule.conditions, ev)
}
