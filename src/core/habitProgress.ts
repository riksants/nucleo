/**
 * Habit progress, always derived from the per-day completions (nothing stored): how often it was done on the
 * days it was expected, and whether a timed session is enough evidence to mark the day.
 */
import type { Habit } from '../data/types'
import { statusOf, type CompletionIndex } from './completions'
import { addDaysToDate } from './period'
import { occursOn } from './recurrence'

/** Done ÷ expected over the last `days` days (today counts only once marked; skipped days are left out). */
export function habitRate(habit: Habit, index: CompletionIndex, today: string, days = 30): { done: number; expected: number; pct: number } {
  let done = 0
  let expected = 0
  for (let i = 0; i < days; i++) {
    const d = addDaysToDate(today, -i)
    if (habit.startDate && d < habit.startDate) break
    if (!occursOn(habit.rule, habit.startDate, d)) continue
    const s = statusOf(index, 'habit', habit.id, d)
    if (s === 'skipped') continue
    if (s === 'pending' && d === today) continue
    expected++
    if (s === 'done') done++
  }
  return { done, expected, pct: expected ? Math.round((done / expected) * 100) : 0 }
}

/** A focus session counts as evidence only when the habit has a length and the session reached it. */
export function sessionReachesGoal(habit: Pick<Habit, 'minutes'>, minutes: number): boolean {
  return typeof habit.minutes === 'number' && habit.minutes > 0 && minutes >= habit.minutes
}
