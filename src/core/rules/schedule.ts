/**
 * Rules by date: "todo dia X do mês", "toda segunda", "uma tarefa atrasar". They run in the
 * automations pass (sync idle, like Parte 1), with fixed ids: two devices write the same record.
 * - Only the most recent occurrence runs; the ones the app missed (since the rule was on, within
 *   31 days, at most 5) are noted as "não rodou" — opening the app never brings a pile of tasks.
 * - A task counts as late once per due date, and only when it became late with the rule on.
 * - Rules by date never reserve money (two devices would add twice; "Guardar todo mês" does that).
 */
import type { BatchOp } from '../../data/repository'
import type { Project, Rule } from '../../data/types'
import { dayInMonth } from '../automation/dates'
import { makeRun, type AutomationCtx } from '../automation/types'
import { addDaysToDate, weekdayOfDate } from '../period'
import { triggerInfo } from './catalog'
import { conditionsHold } from './conditions'
import { activeRules, assertNoInventedFacts, executeEvents, ruleRunId } from './engine'
import type { RuleCtx, RuleEvent } from './types'
import { Work } from './work'

const LOOKBACK_DAYS = 31
const MAX_MISSED = 5
const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

/** The occurrence dates of a date rule between `from` and `to` (inclusive), oldest first. */
export function occurrences(rule: Pick<Rule, 'trigger'>, from: string, to: string): string[] {
  const out: string[] = []
  if (rule.trigger.kind === 'monthDay') {
    const day = Math.min(Math.max(rule.trigger.day ?? 1, 1), 31)
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
      const d = dayInMonth(m, day)
      if (d >= from && d <= to) out.push(d)
      const [y, mo] = m.split('-').map(Number)
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
    }
  } else if (rule.trigger.kind === 'weekDay') {
    const days = new Set(rule.trigger.weekdays ?? [])
    for (let d = from; d <= to; d = addDaysToDate(d, 1)) if (days.has(weekdayOfDate(d))) out.push(d)
  }
  return out
}

const noReserve = (rule: Rule): Rule => ({ ...rule, actions: rule.actions.filter((a) => a.kind !== 'reserveFixed' && a.kind !== 'reservePercent') })

/** Everything the date rules should write now (runs already written are left out). */
export function planScheduledRules(actx: AutomationCtx): BatchOp[] {
  const rules = activeRules(actx.data.rules ?? []).filter((r) => triggerInfo(r.trigger.kind).scheduled).map(noReserve)
  if (!rules.length) return []
  const ctx: RuleCtx = { settings: actx.settings, today: actx.today, convert: actx.convert, now: actx.now }
  const work = new Work(actx.data)
  const known = new Set(actx.data.automationRuns.map((r) => r.id))
  const today = actx.today

  for (const rule of rules) {
    if (!rule.actions.length) continue
    if (rule.trigger.kind === 'taskOverdue') {
      const events: RuleEvent[] = []
      const firstLateDay = addDaysToDate(rule.since, -1)
      for (const t of actx.data.tasks) {
        if (t.status === 'done' || !t.dueDate || t.dueDate >= today || t.dueDate < firstLateDay) continue
        const projeto = t.projectId ? (actx.data.projects.find((p) => p.id === t.projectId) as Project | undefined)?.name : undefined
        events.push({ key: `overdue:${t.id}:${t.dueDate}`, kind: 'taskOverdue', date: today, origin: { collection: 'tasks', id: t.id, label: t.title }, label: `Tarefa atrasada: ${t.title}`, projectId: t.projectId, priority: t.priority, text: t.title, names: { tarefa: t.title, projeto } })
      }
      executeEvents(events, [rule], work, ctx, (r, ev) => conditionsHold(r.conditions, ev))
      continue
    }

    const from = [rule.since, addDaysToDate(today, -LOOKBACK_DAYS)].sort().at(-1)!
    const dates = occurrences(rule, from, today)
    const latest = dates.at(-1)
    if (!latest) continue
    for (const d of dates.slice(0, -1).slice(-MAX_MISSED)) {
      const id = ruleRunId(rule.id, `day:${d}`)
      if (known.has(id)) continue
      work.put('automationRuns', makeRun({ id, automation: 'rule', date: d, summary: `Regra “${rule.name}” não rodou em ${ddmm(d)}`, detail: 'O app não foi aberto nesse dia. Só a vez mais recente roda, para não acumular.', origin: { collection: 'rules', id: rule.id, label: rule.name }, created: [], changed: [], status: 'skipped', rule: { id: rule.id, name: rule.name } }, ctx.now))
      known.add(id)
    }
    const ev: RuleEvent = { key: `day:${latest}`, kind: 'date', date: latest, origin: { collection: 'rules', id: rule.id, label: rule.name }, label: `Dia ${ddmm(latest)}`, names: {} }
    executeEvents([ev], [rule], work, { ...ctx, today: latest }, (r, e) => conditionsHold(r.conditions, e))
  }
  const ops = work.ops()
  assertNoInventedFacts(actx.data, ops)
  return ops
}
