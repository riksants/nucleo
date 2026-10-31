/**
 * Duplicate rules (Etapa 4). Two rules are the SAME when they listen to the same thing, check the same
 * conditions and do the same (order of conditions and actions, name and texts' spacing/case don't matter):
 * saving it again is blocked. They are SIMILAR when they listen to the same thing and do the same kind of
 * action (e.g. two reservations on every income): saving is allowed, with a warning.
 */
import type { Rule, RuleAction, RuleCondition } from '../../data/types'
import type { RuleDraft } from './templates'
import { normalize } from './text'

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
  return typeof v === 'string' ? normalize(v) : v
}
const key = (x: unknown) => JSON.stringify(sortKeys(x))

function triggerKey(t: Rule['trigger']): string {
  return key({ ...t, weekdays: t.weekdays ? [...t.weekdays].sort() : undefined })
}

function conditionKey(c: RuleCondition): string {
  return key('values' in c ? { ...c, values: [...(c.values as (string | number)[])].sort() } : c)
}

export function ruleSignature(d: Pick<RuleDraft, 'trigger' | 'conditions' | 'actions'>): string {
  return key([triggerKey(d.trigger), d.conditions.map(conditionKey).sort(), d.actions.map((a: RuleAction) => key(a)).sort()])
}

export function findTwin(d: Pick<RuleDraft, 'trigger' | 'conditions' | 'actions'>, rules: Rule[], selfId?: string): { same: Rule | null; similar: Rule | null } {
  const sig = ruleSignature(d)
  const kinds = new Set(d.actions.map((a) => a.kind))
  let similar: Rule | null = null
  for (const r of rules) {
    if (r.id === selfId) continue
    if (ruleSignature(r) === sig) return { same: r, similar: null }
    if (!similar && triggerKey(r.trigger) === triggerKey(d.trigger) && r.actions.some((a) => kinds.has(a.kind))) similar = r
  }
  return { same: null, similar }
}
