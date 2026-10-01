/**
 * Streaks are always derived from the per-day completions — never stored as a
 * number. Only days on which the item was expected count: a Mon/Wed/Fri habit
 * doesn't lose its streak on Tuesday. "Skipped" is a pause: it neither adds
 * nor breaks. Today still pending doesn't break anything yet.
 */
import type { CompletionSource, RecurrenceRule } from '../data/types'
import { statusOf, type CompletionIndex } from './completions'
import { addDaysToDate } from './period'
import { occursOn } from './recurrence'

export interface Streak {
  current: number
  /** Last day counted in the streak, or null. */
  lastDone: string | null
}

export function occurrenceStreak(
  source: CompletionSource,
  id: string,
  rule: RecurrenceRule,
  startDate: string,
  index: CompletionIndex,
  today: string,
  maxDays = 400,
): Streak {
  let current = 0
  let lastDone: string | null = null
  let d = today
  for (let i = 0; i < maxDays; i++, d = addDaysToDate(d, -1)) {
    if (startDate && d < startDate) break
    if (!occursOn(rule, startDate, d)) continue
    const status = statusOf(index, source, id, d)
    if (status === 'done') {
      current++
      lastDone ??= d
    } else if (status === 'skipped') continue // pause
    else if (d === today) continue // not over yet
    else break
  }
  return { current, lastDone }
}

/**
 * Weeks in a row in which `achieved(week)` is true, counting back from the
 * current week. The current week only counts once achieved; while it is still
 * open and not achieved, counting starts from the previous week.
 */
export function weekStreak(weeks: string[], achieved: (week: string) => boolean | null): number {
  // weeks: most recent first (current week first)
  let n = 0
  for (let i = 0; i < weeks.length; i++) {
    const a = achieved(weeks[i])
    if (a === true) n++
    else if (i === 0) continue
    else break
  }
  return n
}
