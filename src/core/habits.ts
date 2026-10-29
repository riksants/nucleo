import type { Habit, RecurringItem } from '../data/types'
import { indexCompletions, statusOf, type CompletionIndex, type OccurrenceStatus } from './completions'
import { addDaysToDate } from './period'
import { occursOn } from './recurrence'

/** Active habits scheduled for a date (computed from the rule). */
export function habitsDue(habits: Habit[], date: string): Habit[] {
  return habits.filter((h) => h.active && occursOn(h.rule, h.startDate, date)).sort((a, b) => (a.time || '99') .localeCompare(b.time || '99') || a.name.localeCompare(b.name))
}

/** Whether a recurring item happens on a date, counting occurrences moved with "Adiar". */
export function recurringOn(item: Pick<RecurringItem, 'rule' | 'startDate' | 'moved'>, date: string): boolean {
  const moved = item.moved ?? {}
  if (moved[date]) return false
  for (const to of Object.values(moved)) if (to === date) return true
  return occursOn(item.rule, item.startDate, date)
}

/** Next date on or after `from` (within a year and a bit), or null. */
export function nextRecurring(item: Pick<RecurringItem, 'rule' | 'startDate' | 'moved'>, from: string): string | null {
  for (let i = 0, d = from; i < 400; i++, d = addDaysToDate(d, 1)) if (recurringOn(item, d)) return d
  return null
}

/** Moves one occurrence (`from` → `to`), dropping moves older than two months so the record stays small. */
export function moveOccurrence(item: RecurringItem, from: string, to: string, today: string): RecurringItem {
  const keep = Object.entries(item.moved ?? {}).filter(([orig, dest]) => dest >= addDaysToDate(today, -60) && orig !== from)
  // Moving an already moved occurrence again keeps its original date as the key.
  const origin = Object.entries(item.moved ?? {}).find(([, dest]) => dest === from)?.[0] ?? from
  return { ...item, moved: Object.fromEntries([...keep.filter(([o]) => o !== origin), [origin, to]]) }
}

export function recurringDue(items: RecurringItem[], date: string): RecurringItem[] {
  return items.filter((r) => r.active && recurringOn(r, date)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title))
}

/** Status of a habit on each of the given dates ("off" = not scheduled that day). */
export function habitHistory(habit: Habit, dates: string[], index: CompletionIndex): (OccurrenceStatus | 'off')[] {
  return dates.map((d) => (occursOn(habit.rule, habit.startDate, d) ? statusOf(index, 'habit', habit.id, d) : 'off'))
}

export { indexCompletions }
