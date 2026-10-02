/**
 * Closed-week snapshots: how a week looked when it closed. A week closes on
 * Tuesday 00:00 (person's time zone) — Monday is the grace day to finish the
 * previous week. A snapshot is written once and never rewritten automatically.
 * The id is the week itself, so two devices closing the same week converge.
 */
import type { DataState, Settings, WeekId, WeekSnapshot } from '../data/types'
import { challengeState, endDateOf } from './challenges'
import { METRICS_VERSION, weekMetrics, type RangeMetrics } from './metrics'
import { addDaysToDate, todayIn, weekStart, zoneOf } from './period'
import { computeScore, SCORE_VERSION, scoreToRecord } from './score'
import { goalProgress } from './weekGoals'

/** True from the Tuesday after the week (Monday + 8 days) on. */
export function isClosable(week: WeekId, today: string): boolean {
  return today >= addDaysToDate(week, 8)
}

export function flattenMetrics(m: RangeMetrics): Record<string, number | null> {
  return {
    'items.expected': m.items.expected,
    'items.done': m.items.done,
    'items.skipped': m.items.skipped,
    'tasks.due': m.tasks.due.expected,
    'tasks.dueDone': m.tasks.due.done,
    'tasks.completed': m.tasks.completed,
    'habits.expected': m.habits.expected,
    'habits.done': m.habits.done,
    'habits.skipped': m.habits.skipped,
    'routine.expected': m.routine.expected,
    'routine.done': m.routine.done,
    'recurring.expected': m.recurring.expected,
    'recurring.done': m.recurring.done,
    'training.planned': m.training.planned,
    'training.done': m.training.done,
    'study.minutes': m.study.minutes,
    'study.days': m.study.days,
    events: m.events,
    'finance.income': m.finance?.income ?? null,
    'finance.expense': m.finance?.expense ?? null,
    'finance.net': m.finance?.net ?? null,
    'finance.count': m.finance?.count ?? null,
    'finance.unnecessaryCount': m.finance?.unnecessaryCount ?? null,
    'finance.unnecessaryAmount': m.finance?.unnecessaryAmount ?? null,
    'finance.saved': m.saved,
    'steps.done': m.steps ? m.steps.done : null,
    'meals.planned': m.meals?.planned ?? null,
    'meals.done': m.meals?.done ?? null,
    'meals.days': m.meals?.days ?? null,
  }
}

function hasData(data: DataState, m: RangeMetrics, week: WeekId): boolean {
  return m.items.expected + m.items.skipped + m.events + m.tasks.completed > 0 || m.finance !== null || data.weeklyGoals.some((g) => g.week === week) || data.weekCheckins.some((c) => c.week === week)
}

export function buildSnapshot(data: DataState, settings: Settings, week: WeekId, now = new Date()): Omit<WeekSnapshot, 'createdAt' | 'updatedAt'> {
  const m = weekMetrics(data, settings, week, now)
  const weekEnd = addDaysToDate(week, 6)
  const weekGoals = data.weeklyGoals.filter((g) => g.week === week)
  return {
    id: week,
    week,
    timeZone: zoneOf(settings),
    closedAt: now.toISOString(),
    metricsVersion: METRICS_VERSION,
    metrics: flattenMetrics(m),
    financeTop: m.finance?.top ?? null,
    goals: data.weeklyGoals
      .filter((g) => g.week === week && g.status !== 'archived')
      .map((g) => {
        const p = goalProgress(g, m)
        return { id: g.id, title: g.title, target: p.target, value: p.value, achieved: p.achieved }
      }),
    challenges: data.challenges
      .filter((c) => c.startDate <= weekEnd && endDateOf(c) >= week)
      .map((c) => {
        const s = challengeState(c, data, settings, now)
        return { id: c.id, name: c.name, status: s.status, progress: s.percent }
      }),
    // Kept with its formula version: a future formula never rewrites this week.
    scoreVersion: SCORE_VERSION,
    score: scoreToRecord(computeScore(m, weekGoals)),
  }
}

/** Closable weeks (most recent first, at most `max`) that still have no snapshot and had some data. */
export function weeksToClose(data: DataState, settings: Settings, now = new Date(), max = 8): WeekId[] {
  const today = todayIn(zoneOf(settings), now)
  const existing = new Set(data.weekSnapshots.map((s) => s.week))
  const out: WeekId[] = []
  let week = addDaysToDate(weekStart(today), -7)
  for (let i = 0; i < max; i++, week = addDaysToDate(week, -7)) {
    if (!isClosable(week, today) || existing.has(week)) continue
    if (settings.startedAt && addDaysToDate(week, 6) < settings.startedAt.slice(0, 10)) break
    if (hasData(data, weekMetrics(data, settings, week, now), week)) out.push(week)
  }
  return out
}
