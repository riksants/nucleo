/**
 * "Testar esta regra" (2.1): what the rule would have done in the last days — READ ONLY.
 * It works on an in-memory copy that is thrown away; it never receives save/commit.
 *
 * Honest about what it knows:
 * - the happenings are rebuilt from the records (movements, creation dates, completion dates, the
 *   goals' history, dates); a trigger without history in the data (a status change) is not
 *   simulated: "Não há histórico suficiente para simular este gatilho.";
 * - "projeto concluído" uses the end date and the previous status is unknown (said so);
 * - reservations are ESTIMATES: they use today's balance and rates;
 * - deleted records are not seen.
 */
import type { CollectionName, DataState, Entity, FinanceGoal, Rule, Settings, Task } from '../../data/types'
import type { Converter } from '../../lib/rates'
import { dayOf } from '../indexes'
import { addDaysToDate, zoneOf } from '../period'
import { planActions } from './actions'
import { triggerInfo } from './catalog'
import { checkConditions, triggerMatches, type ConditionCheck } from './conditions'
import { detectEvents } from './events'
import { occurrences } from './schedule'
import type { RuleDraft } from './templates'
import type { RuleCtx, RuleEvent } from './types'
import { Work } from './work'

export const NO_HISTORY = 'Não há histórico suficiente para simular este gatilho.'

export interface SimItem {
  date: string
  label: string
  /** One per condition of the rule, in order (null: could not be checked). */
  conditions: ConditionCheck[]
  /** Every condition passed: the rule would have acted. */
  ran: boolean
  actions: { text: string; ok: boolean; estimated: boolean }[]
}

export interface SimResult {
  /** false: the trigger cannot be rebuilt from the data (nothing is shown as fact). */
  possible: boolean
  days: number
  from: string
  to: string
  items: SimItem[]
  ranCount: number
  /** What is approximate, in the person's words. */
  notes: string[]
}

const withDate = (ev: RuleEvent, date: string): RuleEvent => ({ ...ev, date })

/** The events one past write would have produced (the record as it was "before": absent, or `before`). */
function pastEvents(data: DataState, collection: CollectionName, item: Entity, before: Entity | null, ctx: RuleCtx): RuleEvent[] {
  const list = (data[collection] as Entity[]).filter((x) => x.id !== item.id)
  const prior = { ...data, [collection]: before ? [before, ...list] : list } as DataState
  return detectEvents(prior, [{ op: 'put', collection, item }], ctx)
}

function rebuild(rule: Pick<Rule, 'trigger'>, data: DataState, from: string, to: string, ctx: RuleCtx): { events: RuleEvent[]; possible: boolean; notes: string[] } {
  const tz = zoneOf(ctx.settings)
  const inside = (day: string) => day >= from && day <= to
  const info = triggerInfo(rule.trigger.kind)
  const notes: string[] = []
  const events: RuleEvent[] = []
  switch (info.base) {
    case 'moneyIn':
    case 'moneyOut':
      for (const t of data.transactions) if (inside(dayOf(t.createdAt, tz))) events.push(...pastEvents(data, 'transactions', t, null, ctx))
      break
    case 'saleCreated':
      for (const s of data.sales) if (inside(dayOf(s.createdAt, tz))) events.push(...pastEvents(data, 'sales', s, null, ctx).map((e) => withDate(e, dayOf(s.createdAt, tz))))
      break
    case 'projectCreated':
      for (const p of data.projects) if (inside(dayOf(p.createdAt, tz))) events.push(...pastEvents(data, 'projects', p, null, ctx).filter((e) => e.kind === 'projectCreated').map((e) => withDate(e, dayOf(p.createdAt, tz))))
      break
    case 'clientCreated':
      for (const c of data.clients) if (inside(dayOf(c.createdAt, tz))) events.push(...pastEvents(data, 'clients', c, null, ctx).filter((e) => e.kind === 'clientCreated').map((e) => withDate(e, dayOf(c.createdAt, tz))))
      break
    case 'taskCreated':
      for (const t of data.tasks) if (inside(dayOf(t.createdAt, tz))) events.push(...pastEvents(data, 'tasks', t, null, ctx).filter((e) => e.kind === 'taskCreated').map((e) => withDate(e, dayOf(t.createdAt, tz))))
      break
    case 'taskDone':
      for (const t of data.tasks) {
        if (t.status !== 'done' || !t.completedAt || !inside(dayOf(t.completedAt, tz))) continue
        const open: Task = { ...t, status: 'todo', completedAt: null }
        events.push(...pastEvents(data, 'tasks', t, open, ctx).map((e) => withDate(e, dayOf(t.completedAt!, tz))))
      }
      break
    case 'taskOverdue':
      for (const t of data.tasks) {
        if (!t.dueDate || t.dueDate >= to) continue
        const late = addDaysToDate(t.dueDate, 1)
        if (!inside(late)) continue
        const doneInTime = t.status === 'done' && t.completedAt && dayOf(t.completedAt, tz) <= t.dueDate
        if (doneInTime) continue
        const projeto = data.projects.find((p) => p.id === t.projectId)?.name
        events.push({ key: `overdue:${t.id}:${t.dueDate}`, kind: 'taskOverdue', date: late, origin: { collection: 'tasks', id: t.id, label: t.title }, label: `Tarefa atrasada: ${t.title}`, projectId: t.projectId, priority: t.priority, text: t.title, names: { tarefa: t.title, projeto } })
      }
      break
    case 'goalSaved':
    case 'goalReached':
      for (const g of data.financeGoals) {
        const h = [...(g.history ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))
        for (let k = 1; k < h.length; k++) {
          if (!inside(h[k].date) || h[k].saved <= h[k - 1].saved) continue
          const was: FinanceGoal = { ...g, saved: h[k - 1].saved }
          const now: FinanceGoal = { ...g, saved: h[k].saved }
          events.push(...pastEvents(data, 'financeGoals', now, was, ctx).map((e) => withDate(e, h[k].date)))
        }
      }
      notes.push('Usa o histórico das metas: um dia com várias reservas aparece como uma só.')
      break
    case 'projectStatus':
      if (info.status !== 'done') return { events: [], possible: false, notes: [] }
      for (const p of data.projects) {
        if (p.status !== 'done' || !p.endDate || !inside(p.endDate)) continue
        const cliente = data.clients.find((c) => c.id === p.clientId)?.name
        events.push({ key: `pstatus:${p.id}:done:sim`, kind: 'projectStatus', date: p.endDate, origin: { collection: 'projects', id: p.id, label: p.name }, label: `Projeto ${p.name} concluído`, status: 'done', clientId: p.clientId, projectId: p.id, text: p.name, names: { projeto: p.name, cliente } })
      }
      notes.push('Aproximado: usa a data de conclusão dos projetos; o status anterior não fica guardado.')
      break
    case 'clientStatus':
      return { events: [], possible: false, notes: [] }
    case 'date':
      for (const d of occurrences(rule, from, to)) events.push({ key: `day:${d}`, kind: 'date', date: d, origin: { collection: 'rules', id: '', label: '' }, label: `Dia ${d.slice(8, 10)}/${d.slice(5, 7)}`, names: {} })
      break
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { events, possible: true, notes }
}

/** Simulates `rule` (saved or not) over the last `days` days. Never writes anything. */
export function simulateRule(rule: RuleDraft & { name: string }, data: DataState, settings: Settings, convert: Converter, today: string, now = new Date(), days = 30): SimResult {
  const from = addDaysToDate(today, -(days - 1))
  const ctx: RuleCtx = { settings, today, convert, now }
  const info = triggerInfo(rule.trigger.kind)
  const { events, possible, notes } = rebuild(rule, data, from, today, ctx)
  const result: SimResult = { possible, days, from, to: today, items: [], ranCount: 0, notes }
  if (!possible) return result
  // A throwaway copy: reservations of earlier events lower the Disponível of the next ones, as they would.
  const work = new Work(data)
  const asRule = { ...rule, id: 'simulacao', createdAt: '', updatedAt: '', on: true, since: '0000-01-01', order: 0 } as Rule
  for (const ev of events) {
    if (!info.scheduled && !triggerMatches(asRule, ev)) continue
    let check = checkConditions(rule.conditions, ev, ctx)
    if (info.base === 'projectStatus' && rule.conditions.some((c) => c.field === 'statusBefore')) {
      // The previous status of a past change is not known: that condition is never shown as passed.
      const each = check.each.map((x, k) => (rule.conditions[k].field === 'statusBefore' ? { ok: null, reason: 'o status anterior não fica guardado' } : x))
      check = { ...check, each, ok: each.some((x) => x.ok === false) ? false : null }
    }
    const item: SimItem = { date: ev.date, label: ev.label, conditions: check.each, ran: check.ok === true, actions: [] }
    if (check.ok === true) {
      const plan = planActions(info.scheduled ? { ...asRule, actions: asRule.actions.filter((a) => a.kind !== 'reserveFixed' && a.kind !== 'reservePercent') } : asRule, ev, work, { ...ctx, today: ev.date }, `sim-${result.items.length}`)
      item.actions = plan.results.map((r) => ({ text: r.text, ok: r.ok, estimated: r.def?.kind === 'reserveFixed' || r.def?.kind === 'reservePercent' }))
      result.ranCount++
    }
    result.items.push(item)
  }
  if (result.items.some((x) => x.actions.some((a) => a.estimated))) notes.push('Valores de reserva são estimativas: usam o saldo disponível e as cotações de hoje, não os daquele dia.')
  if (rule.conditions.some((c) => c.field === 'statusBefore') && info.base === 'projectStatus') notes.push('A condição de status anterior não pode ser conferida no passado.')
  notes.push('Registros apagados não entram na simulação.')
  return result
}
