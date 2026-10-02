/**
 * What Morning and Night show, computed from the agenda and the original
 * records (no copies). Kept pure so it can be tested without the UI.
 */
import { isEnabled } from '../app/modules'
import { isPaidTool, nextChargeDate, sortOpenTasks } from '../data/selectors'
import { saleRemaining } from '../data/sales'
import { nextChargeOf } from '../data/subscriptions'
import type { Cents, Currency, DataState, Settings, Task } from '../data/types'
import { buildAgenda, tally, type AgendaItem } from './agenda'
import { addDaysToDate, nowIn, zoneOf } from './period'

export interface MoneyDue {
  key: string
  title: string
  detail: string
  cents: Cents
  currency: Currency
  direction: 'pay' | 'receive'
  path: '/tools' | '/sales' | '/subscribers'
  id: string
}

/** Bills to pay and charges to receive dated exactly on `date`. */
export function moneyDueOn(data: DataState, settings: Settings, date: string, now = new Date()): MoneyDue[] {
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)
  const out: MoneyDue[] = []
  if (on('tools')) {
    for (const t of data.tools) {
      if (isPaidTool(t) && t.status === 'active' && t.nextCharge && nextChargeDate(t, now) === date) out.push({ key: `tool:${t.id}`, title: t.name, detail: 'Cobrança da ferramenta', cents: t.price, currency: t.currency, direction: 'pay', path: '/tools', id: t.id })
    }
  }
  if (on('sales')) {
    for (const s of data.sales) {
      const rest = saleRemaining(s)
      if (s.dueDate === date && rest > 0) out.push({ key: `sale:${s.id}`, title: s.product, detail: 'Prazo para receber', cents: rest, currency: s.currency, direction: 'receive', path: '/sales', id: s.id })
    }
  }
  if (on('subscribers')) {
    const plans = new Map(data.subPlans.map((p) => [p.id, p]))
    for (const s of data.subscribers) {
      const plan = plans.get(s.planId)
      if (s.status === 'active' && plan && nextChargeOf(s, plan, now) === date) out.push({ key: `sub:${s.id}`, title: s.name, detail: `Cobrança · ${plan.name}`, cents: plan.price, currency: plan.currency, direction: 'receive', path: '/subscribers', id: s.id })
    }
  }
  return out
}

export interface DayPlan {
  date: string
  items: AgendaItem[]
  /** Timed items still ahead (or the whole timed list at night). */
  timed: AgendaItem[]
  /** Untimed things to do today (tasks, habits, recurring without a time). */
  anytime: AgendaItem[]
  events: AgendaItem[]
  overdue: Task[]
  priorities: Task[]
  money: MoneyDue[]
  /** Real meals of the day (Etapa 5): own counters, not part of "itens". */
  meals: { planned: number; done: number; next: AgendaItem | null }
  counts: ReturnType<typeof tally> & { habits: number; habitsDone: number; habitsPending: number; tasks: number; tasksDone: number }
}

export function planDay(data: DataState, settings: Settings, now = new Date(), date?: string): DayPlan {
  const n = nowIn(zoneOf(settings), now)
  const day = date ?? n.date
  const items = buildAgenda(data, settings, day, day, now)
  const tasksOn = isEnabled(settings, 'tasks')
  const open = tasksOn ? data.tasks.filter((t) => t.status !== 'done') : []
  const overdue = sortOpenTasks(open.filter((t) => t.dueDate && t.dueDate < day))
  // Priorities: high first, then today's dated tasks — at most 3, no duplicates.
  const todayOpen = open.filter((t) => t.dueDate === day)
  const priorities = [...new Map([...sortOpenTasks(open.filter((t) => t.priority === 'high' && (!t.dueDate || t.dueDate <= day))), ...sortOpenTasks(todayOpen)].map((t) => [t.id, t])).values()].slice(0, 3)
  const habits = items.filter((i) => i.kind === 'habit')
  const tasks = items.filter((i) => i.kind === 'task')
  return {
    date: day,
    items,
    timed: items.filter((i) => i.start && i.kind !== 'event'),
    anytime: items.filter((i) => !i.start && i.checkable),
    events: items.filter((i) => i.kind === 'event'),
    overdue,
    priorities,
    money: moneyDueOn(data, settings, day, now),
    meals: mealsSummary(items, day === n.date ? n.time : ''),
    counts: { ...tally(items), habits: habits.length, habitsDone: habits.filter((h) => h.status === 'done').length, habitsPending: habits.filter((h) => h.status === 'pending').length, tasks: tasks.length, tasksDone: tasks.filter((t) => t.status === 'done').length },
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function mealsSummary(items: AgendaItem[], nowTime: string): DayPlan['meals'] {
  const meals = items.filter((i) => i.source.kind === 'mealEntry')
  const pending = meals.filter((i) => i.status !== 'done')
  const next = pending.find((i) => i.start && (!nowTime || i.start >= nowTime)) ?? pending.find((i) => !i.start) ?? null
  return { planned: meals.length, done: meals.length - pending.length, next }
}

/** "Hoje você tem 5 refeições planejadas." — null when none were planned. */
export function mealsMorningLine(plan: DayPlan): string | null {
  if (!plan.meals.planned) return null
  const n = plan.meals.next
  return `Hoje você tem ${plural(plan.meals.planned, 'refeição planejada', 'refeições planejadas')}${n ? ` · próxima: ${n.start ? `${n.start} ` : ''}${n.title}` : ''}.`
}

/** "4 de 5 refeições planejadas foram marcadas como realizadas." — neutral, no judgement. */
export function mealsNightLine(plan: DayPlan): string | null {
  if (!plan.meals.planned) return null
  return `${plan.meals.done} de ${plural(plan.meals.planned, 'refeição planejada foi marcada como realizada', 'refeições planejadas foram marcadas como realizadas')}.`
}

/** "Hoje você tem 3 tarefas, 1 compromisso às 16h e 4 hábitos para concluir." */
export function morningSentence(plan: DayPlan): string {
  const parts: string[] = []
  const tasksLeft = plan.counts.tasks - plan.counts.tasksDone
  if (tasksLeft) parts.push(plural(tasksLeft, 'tarefa', 'tarefas'))
  if (plan.events.length === 1) parts.push(`1 compromisso às ${plan.events[0].start.replace(':00', 'h').replace(':', 'h')}`)
  else if (plan.events.length > 1) parts.push(plural(plan.events.length, 'compromisso', 'compromissos'))
  const training = plan.items.find((i) => i.kind === 'routine' && i.blockKind === 'training')
  if (training) parts.push(`treino às ${training.start.replace(':00', 'h').replace(':', 'h')}`)
  // Skipped habits are not "to do" anymore.
  const habitsLeft = plan.counts.habitsPending
  if (habitsLeft) parts.push(`${plural(habitsLeft, 'hábito', 'hábitos')} para concluir`)
  if (!parts.length) return 'Hoje está livre. Bom momento para adiantar algo ou descansar.'
  const last = parts.pop()!
  return `Hoje você tem ${parts.length ? `${parts.join(', ')} e ${last}` : last}.`
}

/** "Seu dia terminou com 7 de 9 itens concluídos." Skipped items are left out of the count, not counted as missed. */
export function nightSentence(plan: DayPlan): string {
  const considered = plan.counts.total - plan.counts.skipped
  if (!considered) return 'Nada para fechar hoje.'
  return `Seu dia terminou com ${plan.counts.done} de ${considered} ${considered === 1 ? 'item concluído' : 'itens concluídos'}.`
}

export function tomorrowOf(plan: DayPlan): string {
  return addDaysToDate(plan.date, 1)
}
