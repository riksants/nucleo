/**
 * The one way a rule record is made, by the editor ("Minhas regras") and by the Assistant: same
 * order, same `since`, same defaults. Turning on (again) starts today; nothing before is caught up.
 * "Permitir que ações desta regra ativem outras regras" stays off unless the draft says so.
 */
import type { Rule } from '../../data/types'
import type { RuleDraft } from './templates'

export type RuleRecord = Omit<Rule, 'createdAt' | 'updatedAt'> & Partial<Pick<Rule, 'createdAt' | 'updatedAt'>>

export function ruleRecord(draft: RuleDraft & { name: string }, on: boolean, existing: Rule | undefined, rules: Pick<Rule, 'order'>[], today: string, newId: () => string): RuleRecord {
  const turningOn = on && (!existing || !existing.on || Boolean(existing.paused))
  const order = existing?.order ?? (rules.length ? Math.max(...rules.map((r) => r.order)) + 1 : 0)
  const { paused: _p, chain: _c, confirm: _k, ...rest } = existing ?? ({} as Partial<Rule>)
  void [_p, _c, _k]
  const next: RuleRecord = {
    ...(rest as Partial<Rule>),
    id: existing?.id ?? newId(),
    name: draft.name.trim(),
    trigger: draft.trigger,
    conditions: draft.conditions,
    actions: draft.actions,
    on,
    order,
    since: turningOn ? today : (existing?.since ?? today),
  }
  if (draft.template) next.template = draft.template
  else delete next.template
  if (draft.chain) next.chain = true
  if (draft.confirm) next.confirm = true
  if (existing?.paused && !on) next.paused = existing.paused
  return next
}
