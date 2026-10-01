/**
 * The single catalogue of weekly numbers. Built from the agenda (Etapa 1),
 * which already reads every original record and respects hidden sections, plus
 * task completion dates and transactions. Goals, challenges, the weekly summary
 * and snapshots all read from here, so the same thing is never counted twice.
 *
 * Rule for days: past days count fully; today counts only what is already
 * marked (done/skipped) — pending today is not a miss; future days don't count.
 */
import { isEnabled } from '../app/modules'
import type { DataState, HabitCategory, Settings, WeekId } from '../data/types'
import { wallClock } from '../lib/zoned'
import { buildAgenda, type AgendaItem } from './agenda'
import { addDaysToDate, todayIn, weekDates, zoneOf } from './period'
import { toMinutes } from '../../supabase/functions/_shared/planner/time.ts'

export const METRICS_VERSION = 1

export interface Tally {
  /** Considered occurrences (excludes skipped). */
  expected: number
  done: number
  skipped: number
}

export interface DayFacts {
  date: string
  /** false for future days. */
  counted: boolean
  habitsDone: string[]
  categoriesDone: HabitCategory[]
  trainingPlanned: boolean
  trainingDone: boolean
  studyDone: boolean
  studyMinutes: number
  routine: Tally
  /** Manual challenge marks done this day (challenge ids). */
  challengeMarks: string[]
}

export interface RangeMetrics {
  from: string
  to: string
  /** Every day of the range is in the past. */
  closed: boolean
  items: Tally
  tasks: { due: Tally; completed: number }
  habits: Tally & { byHabit: Record<string, Tally> }
  /** Habits without the "training" category (training is counted only in `training`). */
  habitsNoTraining: Tally
  routine: Tally & { minutesDone: number }
  /** Routine blocks without training blocks (training is counted only in `training`). */
  routineNoTraining: Tally
  recurring: Tally & { byItem: Record<string, Tally> }
  training: { planned: number; done: number }
  study: { minutes: number; days: number }
  events: number
  /** null when the finance section is off or there were no movements. Base currency cents. */
  finance: { income: number; expense: number; net: number } | null
  days: DayFacts[]
}

const blank = (): Tally => ({ expected: 0, done: 0, skipped: 0 })

function add(t: Tally, status: AgendaItem['status'], counted: boolean) {
  if (status === 'skipped') t.skipped++
  else if (status === 'done') {
    t.expected++
    t.done++
  } else if (counted) t.expected++
}

const ROUTINE_EXCLUDED = new Set(['commute', 'meal'])

const blockMinutes = (i: AgendaItem) => Math.max(0, toMinutes(i.end) - toMinutes(i.start))

export function rangeMetrics(data: DataState, settings: Settings, from: string, to: string, now = new Date()): RangeMetrics {
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const items = buildAgenda(data, settings, from, to, now)
  const out: RangeMetrics = {
    from,
    to,
    closed: to < today,
    items: blank(),
    tasks: { due: blank(), completed: 0 },
    habits: { ...blank(), byHabit: {} },
    habitsNoTraining: blank(),
    routine: { ...blank(), minutesDone: 0 },
    routineNoTraining: blank(),
    recurring: { ...blank(), byItem: {} },
    training: { planned: 0, done: 0 },
    study: { minutes: 0, days: 0 },
    events: 0,
    finance: null,
    days: [],
  }

  const byDate = new Map<string, AgendaItem[]>()
  for (const i of items) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i])

  for (let d = from, guard = 0; d <= to && guard < 400; d = addDaysToDate(d, 1), guard++) {
    const future = d > today
    const fact: DayFacts = { date: d, counted: !future, habitsDone: [], categoriesDone: [], trainingPlanned: false, trainingDone: false, studyDone: false, studyMinutes: 0, routine: blank(), challengeMarks: [] }
    for (const i of byDate.get(d) ?? []) {
      // Today: pending is not a miss yet. Future: nothing counts.
      const counted = d < today || (d === today && i.status !== 'pending')
      if (future) continue
      if (i.kind === 'event') {
        out.events++
        continue
      }
      if (!i.checkable) continue
      add(out.items, i.status, counted)
      if (i.source.kind === 'task') add(out.tasks.due, i.status, counted)
      if (i.source.kind === 'habit') {
        const h = i.source.habit
        add(out.habits, i.status, counted)
        add((out.habits.byHabit[h.id] ??= blank()), i.status, counted)
        if (h.category !== 'training') add(out.habitsNoTraining, i.status, counted)
        if (h.category === 'training' && i.status !== 'skipped') fact.trainingPlanned = true
        if (i.status === 'done') {
          fact.habitsDone.push(h.id)
          if (h.category) fact.categoriesDone.push(h.category)
          if (h.category === 'training') fact.trainingDone = true
          if (h.category === 'study') fact.studyDone = true
        }
      }
      if (i.source.kind === 'recurring') {
        add(out.recurring, i.status, counted)
        add((out.recurring.byItem[i.source.item.id] ??= blank()), i.status, counted)
      }
      if (i.source.kind === 'routine') {
        const kind = i.blockKind ?? 'other'
        if (kind === 'training' && i.status !== 'skipped') fact.trainingPlanned = true
        if (!ROUTINE_EXCLUDED.has(kind)) {
          add(out.routine, i.status, counted)
          add(fact.routine, i.status, counted)
          if (kind !== 'training') add(out.routineNoTraining, i.status, counted)
        }
        if (i.status === 'done') {
          if (kind === 'training') fact.trainingDone = true
          if (kind === 'study') {
            fact.studyDone = true
            fact.studyMinutes += blockMinutes(i)
          }
          if (!ROUTINE_EXCLUDED.has(kind)) out.routine.minutesDone += blockMinutes(i)
        }
      }
    }
    // Manual challenge marks of the day.
    for (const c of data.completions) if (c.source === 'challenge' && c.date === d && c.status === 'done') fact.challengeMarks.push(c.sourceId)
    // Training counts at most once per day, whatever the source (routine + habit).
    // A planned training day counts once it is over, or today once it is done (pending today is not a miss; skipped is a pause).
    if (fact.trainingPlanned && (d < today || fact.trainingDone)) out.training.planned++
    if (fact.trainingDone) out.training.done++
    if (fact.studyDone) out.study.days++
    out.study.minutes += fact.studyMinutes
    out.days.push(fact)
  }

  // Tasks completed in the period (by completion date in the person's zone).
  if (isEnabled(settings, 'tasks')) {
    for (const t of data.tasks) {
      if (t.status !== 'done' || !t.completedAt) continue
      const day = wallClock(new Date(t.completedAt), tz).date
      if (day >= from && day <= to) out.tasks.completed++
    }
  }

  // Money in/out of the period, base currency (adjustments are not income nor expense).
  if (isEnabled(settings, 'finance')) {
    let income = 0
    let expense = 0
    let any = false
    for (const t of data.transactions) {
      const day = wallClock(new Date(t.createdAt), tz).date
      if (day < from || day > to || t.type === 'adjust') continue
      any = true
      if (t.type === 'in') income += t.baseAmount
      else expense -= t.baseAmount
    }
    if (any) out.finance = { income, expense, net: income - expense }
  }
  return out
}

export function weekMetrics(data: DataState, settings: Settings, week: WeekId, now = new Date()): RangeMetrics {
  const dates = weekDates(week)
  return rangeMetrics(data, settings, dates[0], dates[6], now)
}

export const percent = (t: Tally): number | null => (t.expected ? Math.round((t.done / t.expected) * 100) : null)

/**
 * Value of a metric key for goals and challenges. null = no data (never 0 by default).
 *   items.done · items.percent · tasks.completed · habits.done · habits.percent ·
 *   habit:<id> · category:<cat> · routine.percent · recurring:<id> ·
 *   training.days · study.minutes · study.days · finance.net (cents)
 */
export function metricValue(m: RangeMetrics, key: string): number | null {
  if (key.startsWith('habit:')) return m.habits.byHabit[key.slice(6)]?.done ?? 0
  if (key.startsWith('recurring:')) return m.recurring.byItem[key.slice(10)]?.done ?? 0
  if (key.startsWith('category:')) return m.days.filter((d) => d.categoriesDone.includes(key.slice(9) as HabitCategory)).length
  switch (key) {
    case 'items.done':
      return m.items.done
    case 'items.percent':
      return percent(m.items)
    case 'tasks.completed':
      return m.tasks.completed
    case 'habits.done':
      return m.habits.done
    case 'habits.percent':
      return percent(m.habits)
    case 'routine.percent':
      return percent(m.routine)
    case 'training.days':
      return m.training.done
    case 'study.minutes':
      return m.study.minutes
    case 'study.days':
      return m.study.days
    case 'finance.net':
      return m.finance ? m.finance.net : null
    default:
      return null
  }
}
