import { useCallback, useMemo } from 'react'
import { dayInMonth } from '../../core/automation/dates'
import { findCategory } from '../../core/financeCategories'
import { todayIn, zoneOf } from '../../core/period'
import type { Names } from '../../core/rules/sentence'
import { markSuggestion, ruleSuggestions, SNOOZE_DAYS, visibleSuggestion, type RuleSuggestion } from '../../core/rules/suggestions'
import type { RuleDraft } from '../../core/rules/templates'
import { addDaysToDate } from '../../core/period'
import { newId, useStore } from '../../data/store'
import type { AutomationRun, Rule, Tool } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { categoryLabel } from '../../core/financeCategories'

const byOrder = (a: Rule, b: Rule) => a.order - b.order || (a.createdAt < b.createdAt ? -1 : 1)

/** Names for the sentences of the rules (deleted items get a neutral word). */
export function useRuleNames(): Names {
  const { data, settings } = useStore()
  return useMemo(() => {
    const goals = new Map(data.financeGoals.map((g) => [g.id, g]))
    const clients = new Map(data.clients.map((c) => [c.id, c.name]))
    const projects = new Map(data.projects.map((p) => [p.id, p.name]))
    return {
      goal: (id) => goals.get(id)?.name,
      goalCurrency: (id) => goals.get(id)?.currency,
      client: (id) => clients.get(id),
      project: (id) => projects.get(id),
      category: (id) => (findCategory(settings, id) ? categoryLabel(settings, id) : 'categoria apagada'),
      money: (c, cur) => formatMoney(c, cur),
    }
  }, [data.financeGoals, data.clients, data.projects, settings])
}

export function ruleStats(ruleId: string, runs: AutomationRun[]): { count: number; last: string | null } {
  const mine = runs.filter((r) => r.rule?.id === ruleId && r.status === 'done')
  return { count: mine.length, last: mine.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null) }
}

export function useRules() {
  const { data, settings, save, remove, commit, updateSettings } = useStore()
  const rules = useMemo(() => [...data.rules].sort(byOrder), [data.rules])
  const today = todayIn(zoneOf(settings))

  /** New (no `id`) or edited. Turning on (again) starts today: nothing before is caught up. */
  const saveRule = useCallback(
    async (draft: RuleDraft, on: boolean, existing?: Rule) => {
      const turningOn = on && (!existing || !existing.on || existing.paused)
      const order = existing?.order ?? (rules.length ? Math.max(...rules.map((r) => r.order)) + 1 : 0)
      const { paused: _p, ...rest } = existing ?? ({} as Partial<Rule>)
      void _p
      const next = {
        ...rest,
        ...draft,
        on,
        order,
        since: turningOn ? today : (existing?.since ?? today),
        ...(existing?.paused && !on ? { paused: existing.paused } : {}),
      }
      return save('rules', next as Rule)
    },
    [rules, today, save],
  )

  const setOn = useCallback(
    (rule: Rule, on: boolean) => {
      const { paused: _p, ...rest } = rule
      void _p
      return save('rules', { ...rest, on, since: on ? today : rule.since })
    },
    [save, today],
  )

  const duplicate = useCallback(
    (rule: Rule) => {
      const { id: _i, createdAt: _c, updatedAt: _u, paused: _p, ...rest } = rule
      void [_i, _c, _u, _p]
      return save('rules', { ...rest, name: `${rule.name} (cópia)`, on: false, order: Math.max(...rules.map((r) => r.order)) + 1, since: today })
    },
    [rules, save, today],
  )

  /** Moves a rule one place up/down in the order (rules answering the same event run top first). */
  const move = useCallback(
    (rule: Rule, dir: -1 | 1) => {
      const i = rules.findIndex((r) => r.id === rule.id)
      const other = rules[i + dir]
      if (!other) return
      // Renumber everything so equal orders (old data) can't get stuck.
      const ordered = [...rules]
      ordered[i] = other
      ordered[i + dir] = rule
      return commit(ordered.map((r, n) => ({ op: 'put' as const, collection: 'rules' as const, item: { ...r, order: n } })).filter((o) => rules.find((r) => r.id === o.item.id)!.order !== o.item.order))
    },
    [rules, commit],
  )

  const removeRule = useCallback((rule: Rule) => remove('rules', rule.id), [remove])

  // ---- Suggestions
  const suggestions = useMemo(() => ruleSuggestions(data, settings, today), [data, settings, today])
  const suggestion: RuleSuggestion | null = useMemo(() => visibleSuggestion(suggestions, settings.ruleSuggestions, today), [suggestions, settings.ruleSuggestions, today])

  const answer = useCallback(
    (key: string, s: 'dismissed' | 'snoozed' | 'accepted') => updateSettings({ ruleSuggestions: markSuggestion(settings.ruleSuggestions, key, s === 'snoozed' ? { s, until: addDaysToDate(today, SNOOZE_DAYS) } : { s }) }),
    [settings.ruleSuggestions, today, updateSettings],
  )

  /** "Cadastrar como conta fixa": an Assinatura with "A pagar" every month (the person confirms each payment). */
  const createFixedBill = useCallback(
    async (input: { name: string; amount: number; currency: string; day: number }) => {
      const thisMonth = dayInMonth(today.slice(0, 7), input.day)
      const nextCharge = thisMonth >= today ? thisMonth : dayInMonth(addDaysToDate(`${today.slice(0, 7)}-28`, 7).slice(0, 7), input.day)
      const tool: Omit<Tool, 'createdAt' | 'updatedAt'> = { id: newId(), name: input.name, link: '', plan: '', price: input.amount, currency: input.currency, billing: 'monthly', nextCharge, notes: 'Cadastrada a partir de uma sugestão do Núcleo.', status: 'active', autoPaid: false }
      return save('tools', tool as Tool)
    },
    [today, save],
  )

  return { rules, saveRule, setOn, duplicate, move, removeRule, suggestion, answer, createFixedBill, today }
}
