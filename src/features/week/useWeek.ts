import { useMemo } from 'react'
import { indexCompletions } from '../../core/completions'
import { weekMetrics } from '../../core/metrics'
import { addDaysToDate, useToday, weekStart, zoneOf } from '../../core/period'
import { computeScore, SCORE_VERSION, type ScoreResult } from '../../core/score'
import { flattenMetrics, isClosable } from '../../core/snapshots'
import type { FlatMetrics } from '../../core/weekSummary'
import { useStore } from '../../data/store'
import type { WeekId } from '../../data/types'

/**
 * Everything the Week screen shows for one week. Live numbers are computed from
 * records (memoized for 7 days); a closed week with a snapshot shows the
 * snapshot as it was when the week closed.
 */
export function useWeek(week: WeekId) {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  const current = weekStart(today)
  const prevWeek = addDaysToDate(week, -7)
  const snapshot = data.weekSnapshots.find((s) => s.week === week) ?? null
  const prevSnapshot = data.weekSnapshots.find((s) => s.week === prevWeek) ?? null

  const metrics = useMemo(() => weekMetrics(data, settings, week), [data, settings, week, today])
  const prevMetrics = useMemo(() => (prevSnapshot ? null : weekMetrics(data, settings, prevWeek)), [data, settings, prevWeek, prevSnapshot, today])
  const goals = useMemo(() => data.weeklyGoals.filter((g) => g.week === week && g.status !== 'archived'), [data.weeklyGoals, week])
  const liveScore = useMemo(() => computeScore(metrics, goals), [metrics, goals])
  const prevGoals = useMemo(() => data.weeklyGoals.filter((g) => g.week === prevWeek && g.status !== 'archived'), [data.weeklyGoals, prevWeek])
  const index = useMemo(() => indexCompletions(data.completions), [data.completions])

  const flat: FlatMetrics = snapshot ? snapshot.metrics : flattenMetrics(metrics)
  const prevFlat: FlatMetrics = prevSnapshot ? prevSnapshot.metrics : flattenMetrics(prevMetrics!)
  // Historic score keeps its own version; only same-version scores are compared.
  const score: { overall: number | null; areas: Record<string, number | null>; version: number; live: ScoreResult | null } = snapshot?.score
    ? { overall: snapshot.score.overall ?? null, areas: snapshot.score, version: snapshot.scoreVersion ?? SCORE_VERSION, live: null }
    : { overall: liveScore.overall, areas: Object.fromEntries(Object.entries(liveScore.areas).map(([k, v]) => [k, v.score])), version: SCORE_VERSION, live: liveScore }
  const prevOverall = prevSnapshot?.score && prevSnapshot.scoreVersion === score.version ? (prevSnapshot.score.overall ?? null) : prevMetrics ? computeScore(prevMetrics, prevGoals).overall : null

  return {
    week,
    today,
    current,
    isCurrent: week === current,
    isFuture: week > current,
    closed: isClosable(week, today),
    snapshot,
    metrics,
    flat,
    prevFlat,
    goals,
    score,
    prevOverall,
    index,
  }
}
