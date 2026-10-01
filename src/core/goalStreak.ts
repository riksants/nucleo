import type { DataState, Settings, WeekId, WeeklyGoal } from '../data/types'
import { weekMetrics } from './metrics'
import { addDaysToDate } from './period'
import { weekStreak } from './streaks'
import { goalProgress } from './weekGoals'

/**
 * Weeks in a row in which the "same" goal (same repeatKey) was achieved,
 * counting back from `week`. Closed weeks read their snapshot; others are
 * computed live. Looks back at most `maxWeeks`.
 */
export function goalWeekStreak(data: DataState, settings: Settings, goal: WeeklyGoal, maxWeeks = 12, now = new Date()): number {
  const siblings = new Map(data.weeklyGoals.filter((g) => g.repeatKey === goal.repeatKey && g.status !== 'archived').map((g) => [g.week, g]))
  if (siblings.size < 1) return 0
  const weeks: WeekId[] = Array.from({ length: maxWeeks }, (_, i) => addDaysToDate(goal.week, -7 * i))
  return weekStreak(weeks, (w) => {
    const g = siblings.get(w)
    if (!g) return false
    const snap = data.weekSnapshots.find((s) => s.week === w)
    const fromSnap = snap?.goals.find((x) => x.id === g.id)
    if (fromSnap) return fromSnap.achieved
    return goalProgress(g, weekMetrics(data, settings, w, now)).achieved
  })
}
