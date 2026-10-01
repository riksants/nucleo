import type { Habit, RecurringItem } from '../data/types'
import { indexCompletions, statusOf, type CompletionIndex, type OccurrenceStatus } from './completions'
import { occursOn } from './recurrence'

/** Active habits scheduled for a date (computed from the rule). */
export function habitsDue(habits: Habit[], date: string): Habit[] {
  return habits.filter((h) => h.active && occursOn(h.rule, h.startDate, date)).sort((a, b) => (a.time || '99') .localeCompare(b.time || '99') || a.name.localeCompare(b.name))
}

export function recurringDue(items: RecurringItem[], date: string): RecurringItem[] {
  return items.filter((r) => r.active && occursOn(r.rule, r.startDate, date)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title))
}

/** Status of a habit on each of the given dates ("off" = not scheduled that day). */
export function habitHistory(habit: Habit, dates: string[], index: CompletionIndex): (OccurrenceStatus | 'off')[] {
  return dates.map((d) => (occursOn(habit.rule, habit.startDate, d) ? statusOf(index, 'habit', habit.id, d) : 'off'))
}

export { indexCompletions }
