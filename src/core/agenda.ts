/**
 * One view of the day/week built from the original records. Nothing here is
 * stored: every item points back to its source (task, appointment, routine
 * block, habit, recurring item, meal) and its state comes from that source.
 */
import { isTime, toMinutes } from '../../supabase/functions/_shared/planner/time.ts'
import { isEnabled } from '../app/modules'
import type { BlockKind, CalendarEvent, DataState, Habit, MealPlan, PlannedMeal, RecurringItem, RoutineBlock, RoutinePlan, Settings, Task } from '../data/types'
import { indexCompletions, routineStatus, statusOf, type CompletionIndex } from './completions'
import { habitsDue, recurringDue } from './habits'
import { addDaysToDate, nowIn, weekdayOfDate, zoneOf } from './period'

export type AgendaKind = 'event' | 'task' | 'routine' | 'habit' | 'recurring' | 'meal'

/**
 * done / skipped / pending for things you mark; "ended" is only a neutral
 * "time is over" for appointments — never counted as done.
 */
export type AgendaStatus = 'done' | 'skipped' | 'pending' | 'ended'

export type AgendaSource =
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'task'; task: Task }
  | { kind: 'routine'; block: RoutineBlock; plan: RoutinePlan }
  | { kind: 'habit'; habit: Habit }
  | { kind: 'recurring'; item: RecurringItem }
  | { kind: 'meal'; meal: PlannedMeal }

export interface AgendaItem {
  key: string
  kind: AgendaKind
  date: string
  /** "" = no set time (all day). */
  start: string
  end: string
  title: string
  status: AgendaStatus
  /** Can be marked done from the agenda (appointments and meals can't). */
  checkable: boolean
  /** For routine blocks: work, training, study… */
  blockKind?: BlockKind
  source: AgendaSource
}

export const KIND_LABEL: Record<AgendaKind, string> = {
  event: 'Compromisso',
  task: 'Tarefa',
  routine: 'Rotina',
  habit: 'Hábito',
  recurring: 'Recorrente',
  meal: 'Refeição',
}

const BLOCK_LABEL: Partial<Record<BlockKind, string>> = { training: 'Treino', study: 'Estudo', work: 'Trabalho', commute: 'Deslocamento', meal: 'Refeição' }

export function itemLabel(item: AgendaItem): string {
  if (item.kind === 'task' && item.start) return 'Tarefa com horário'
  if (item.kind === 'routine' && item.blockKind && BLOCK_LABEL[item.blockKind]) return BLOCK_LABEL[item.blockKind]!
  return KIND_LABEL[item.kind]
}

const minutes = (t: string) => (isTime(t) ? toMinutes(t) : -1)

export function sortAgenda(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : minutes(a.start) - minutes(b.start) || a.title.localeCompare(b.title)))
}

interface Ctx {
  data: DataState
  settings: Settings
  index: CompletionIndex
  today: string
  nowTime: string
}

function dayItems(ctx: Ctx, date: string): AgendaItem[] {
  const { data, settings, index } = ctx
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)
  const out: AgendaItem[] = []
  const weekday = weekdayOfDate(date)

  if (on('agenda')) {
    for (const event of data.events) {
      if (event.date !== date) continue
      const over = date < ctx.today || (date === ctx.today && isTime(event.end) && event.end <= ctx.nowTime)
      out.push({ key: `event:${event.id}`, kind: 'event', date, start: event.start, end: event.end, title: event.title, status: over ? 'ended' : 'pending', checkable: false, source: { kind: 'event', event } })
    }
  }

  if (on('tasks')) {
    for (const task of data.tasks) {
      if (task.dueDate !== date) continue
      const start = task.dueTime && isTime(task.dueTime) ? task.dueTime : ''
      out.push({ key: `task:${task.id}`, kind: 'task', date, start, end: '', title: task.title, status: task.status === 'done' ? 'done' : 'pending', checkable: true, source: { kind: 'task', task } })
    }
  }

  const plan = data.routinePlans.find((p) => p.id === 'routine-current')
  if (on('routine') && plan) {
    for (const block of plan.blocks) {
      // Meals come from the meal plan when it exists, to avoid showing lunch twice.
      if (block.day !== weekday || (block.kind === 'meal' && on('meals') && data.mealPlans.some((m) => m.id === 'meals-current'))) continue
      out.push({
        key: `routine:${block.id}:${date}`,
        kind: 'routine',
        date,
        start: block.start,
        end: block.end,
        title: block.title,
        status: routineStatus(index, plan, block.id, date),
        checkable: true,
        blockKind: block.kind,
        source: { kind: 'routine', block, plan },
      })
    }
  }

  const meals = data.mealPlans.find((p) => p.id === 'meals-current') as MealPlan | undefined
  if (on('meals') && meals) {
    for (const meal of meals.meals) {
      if (meal.day !== weekday) continue
      out.push({ key: `meal:${meal.id}:${date}`, kind: 'meal', date, start: meal.time, end: '', title: meal.label, status: 'pending', checkable: false, source: { kind: 'meal', meal } })
    }
  }

  if (on('habits')) {
    for (const habit of habitsDue(data.habits, date)) {
      out.push({ key: `habit:${habit.id}:${date}`, kind: 'habit', date, start: habit.time, end: '', title: habit.name, status: statusOf(index, 'habit', habit.id, date), checkable: true, source: { kind: 'habit', habit } })
    }
  }

  if (on('recurring')) {
    for (const item of recurringDue(data.recurring, date)) {
      out.push({ key: `recurring:${item.id}:${date}`, kind: 'recurring', date, start: item.time, end: '', title: item.title, status: statusOf(index, 'recurring', item.id, date), checkable: true, source: { kind: 'recurring', item } })
    }
  }
  return out
}

/** Items from `from` to `to` (inclusive), in the person's time zone. */
export function buildAgenda(data: DataState, settings: Settings, from: string, to: string, now = new Date()): AgendaItem[] {
  const n = nowIn(zoneOf(settings), now)
  const ctx: Ctx = { data, settings, index: indexCompletions(data.completions), today: n.date, nowTime: n.time }
  const out: AgendaItem[] = []
  for (let d = from, i = 0; d <= to && i < 62; d = addDaysToDate(d, 1), i++) out.push(...dayItems(ctx, d))
  return sortAgenda(out)
}

/** Counts for summaries: appointments are never counted as done or pending to-dos. */
export function tally(items: AgendaItem[]) {
  const todo = items.filter((i) => i.checkable)
  return {
    done: todo.filter((i) => i.status === 'done').length,
    skipped: todo.filter((i) => i.status === 'skipped').length,
    pending: todo.filter((i) => i.status === 'pending').length,
    total: todo.length,
    events: items.filter((i) => i.kind === 'event').length,
  }
}
