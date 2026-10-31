import type { Habit, RecurringItem } from '../data/types'
import { indexCompletions, statusOf, type CompletionIndex, type OccurrenceStatus } from './completions'
import { addDaysToDate } from './period'
import { occursOn } from './recurrence'

/** Active habits scheduled for a date (computed from the rule). */
export function habitsDue(habits: Habit[], date: string): Habit[] {
  return habits.filter((h) => h.active && occursOn(h.rule, h.startDate, date)).sort((a, b) => (a.time || '99') .localeCompare(b.time || '99') || a.name.localeCompare(b.name))
}

type RecurringRuleFields = Pick<RecurringItem, 'rule' | 'startDate' | 'moved' | 'endDate'>

/** Whether a recurring item happens on a date, counting occurrences moved with "Adiar" and its last day. */
export function recurringOn(item: RecurringRuleFields, date: string): boolean {
  const moved = item.moved ?? {}
  if (moved[date]) return false
  for (const [from, to] of Object.entries(moved)) if (to === date) return !item.endDate || from <= item.endDate
  if (item.endDate && date > item.endDate) return false
  return occursOn(item.rule, item.startDate, date)
}

/** The time of the occurrence on `date`: its own ("só esta") or the item's. */
export function recurringTime(item: Pick<RecurringItem, 'time' | 'times'>, date: string): string {
  return item.times?.[date] ?? item.time
}

export type RecurringState = 'active' | 'paused' | 'ended'

/** Ativo · Pausado (desativado, volta quando quiser) · Encerrado (passou do último dia). */
export function recurringState(item: Pick<RecurringItem, 'active' | 'endDate'>, today: string): RecurringState {
  if (item.endDate && item.endDate < today) return 'ended'
  return item.active ? 'active' : 'paused'
}

/** Next date on or after `from` (within a year and a bit), or null. */
export function nextRecurring(item: RecurringRuleFields, from: string): string | null {
  for (let i = 0, d = from; i < 400; i++, d = addDaysToDate(d, 1)) if (recurringOn(item, d)) return d
  return null
}

/** Moves one occurrence (`from` → `to`), dropping moves older than two months so the record stays small. */
export function moveOccurrence(item: RecurringItem, from: string, to: string, today: string): RecurringItem {
  const keep = Object.entries(item.moved ?? {}).filter(([orig, dest]) => dest >= addDaysToDate(today, -60) && orig !== from)
  // Moving an already moved occurrence again keeps its original date as the key.
  const origin = Object.entries(item.moved ?? {}).find(([, dest]) => dest === from)?.[0] ?? from
  const times = { ...(item.times ?? {}) }
  // The time chosen for that occurrence goes with it.
  if (times[from] !== undefined) {
    times[to] = times[from]
    delete times[from]
  }
  return { ...item, moved: Object.fromEntries([...keep.filter(([o]) => o !== origin), [origin, to]]), ...(Object.keys(times).length ? { times } : {}) }
}

/** "Só esta": moves one occurrence to another date and/or time; the rule stays. Old per-day times are dropped. */
export function rescheduleOccurrence(item: RecurringItem, from: string, to: { date: string; time: string }, today: string): RecurringItem {
  const moved = to.date === from ? item : moveOccurrence(item, from, to.date, today)
  const times = Object.fromEntries(Object.entries(moved.times ?? {}).filter(([d]) => d >= addDaysToDate(today, -60) && d !== to.date))
  if (to.time !== item.time) times[to.date] = to.time
  const { times: _old, ...rest } = moved
  return Object.keys(times).length ? { ...rest, times } : rest
}

/**
 * "Esta e as próximas": the current item ends the day before `from` (its history stays where it is) and a
 * continuation starts on `from` with the changes. Two records that never overlap, so nothing shows twice.
 * Returns null when `from` is the first day: then the item itself is simply changed.
 */
export function splitRecurring(item: RecurringItem, from: string, changes: Partial<Pick<RecurringItem, 'title' | 'time' | 'rule' | 'notes' | 'bill' | 'remindDays' | 'remindMin'>>): { ended: RecurringItem; next: Omit<RecurringItem, 'id' | 'createdAt' | 'updatedAt'> } | null {
  if (from <= item.startDate) return null
  const own = <T,>(m: Record<string, T> | undefined, future: boolean) => Object.fromEntries(Object.entries(m ?? {}).filter(([d]) => (future ? d >= from : d < from)))
  const { id: _id, createdAt: _c, updatedAt: _u, ...base } = item
  const nextMoved = own(item.moved, true)
  // A new time for all the next ones replaces the times set for single days from then on.
  const nextTimes = changes.time !== undefined ? {} : own(item.times, true)
  const next = { ...base, ...changes, startDate: from, moved: nextMoved, times: nextTimes }
  if (!Object.keys(nextMoved).length) delete (next as Partial<RecurringItem>).moved
  if (!Object.keys(nextTimes).length) delete (next as Partial<RecurringItem>).times
  const ended: RecurringItem = { ...item, endDate: addDaysToDate(from, -1), moved: own(item.moved, false), times: own(item.times, false) }
  return { ended, next }
}

/** "Encerrar": the last day is today when today's occurrence was already marked, otherwise yesterday. */
export function endRecurring(item: RecurringItem, today: string, markedToday: boolean): RecurringItem {
  return { ...item, endDate: markedToday ? today : addDaysToDate(today, -1) }
}

export function recurringDue(items: RecurringItem[], date: string): RecurringItem[] {
  return items.filter((r) => r.active && recurringOn(r, date)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title))
}

/** Status of a habit on each of the given dates ("off" = not scheduled that day). */
export function habitHistory(habit: Habit, dates: string[], index: CompletionIndex): (OccurrenceStatus | 'off')[] {
  return dates.map((d) => (occursOn(habit.rule, habit.startDate, d) ? statusOf(index, 'habit', habit.id, d) : 'off'))
}

export { indexCompletions }
