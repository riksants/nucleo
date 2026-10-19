/**
 * Does a rule answer this event? The trigger must match, then every condition (AND). A condition
 * with several values holds when the event has any of them (OR inside one condition).
 * A value condition only matches events in its own currency: €500 is never compared with R$500.
 */
import type { Rule, RuleCondition, Weekday } from '../../data/types'
import { weekdayOfDate } from '../period'
import { triggerInfo } from './catalog'
import { normalize } from './text'
import type { RuleEvent } from './types'

export function triggerMatches(rule: Pick<Rule, 'trigger'>, ev: RuleEvent): boolean {
  const t = triggerInfo(rule.trigger.kind)
  if (t.scheduled || t.base !== ev.kind) return false
  if (t.origin && ev.moneyOrigin !== t.origin) return false
  if (t.status && ev.status !== t.status) return false
  return true
}

const has = (values: readonly string[], v: string | null | undefined) => v != null && values.includes(v)

export function conditionHolds(c: RuleCondition, ev: RuleEvent): boolean {
  switch (c.field) {
    case 'amount': {
      if (ev.amount === undefined || ev.currency !== c.currency) return false
      if (c.op === 'gt') return ev.amount > c.value
      if (c.op === 'lt') return ev.amount < c.value
      const lo = Math.min(c.value, c.value2 ?? c.value)
      const hi = Math.max(c.value, c.value2 ?? c.value)
      return ev.amount >= lo && ev.amount <= hi
    }
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
