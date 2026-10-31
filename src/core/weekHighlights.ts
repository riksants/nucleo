/**
 * "Avançou" and "Ficou pendente" for one week, straight from the records (never inferred): tasks completed in
 * the week, weekly goals reached, plan steps done; and tasks that were due in the week (until today) and stay
 * open. At most three of each, the most relevant first.
 */
import type { DataState, PlanStep, Task } from '../data/types'
import { sortOpenTasks } from '../data/selectors'
import { addDaysToDate } from './period'

export interface Highlights {
  advanced: { key: string; text: string }[]
  pending: { key: string; text: string; task: Task }[]
  /** How many there were in total (the lists are cut at three). */
  advancedTotal: number
  pendingTotal: number
}

const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10)

export function weekHighlights(data: Pick<DataState, 'tasks' | 'planSteps' | 'weeklyGoals'>, week: string, today: string, reachedGoalIds: string[] = []): Highlights {
  const end = addDaysToDate(week, 6)
  const inWeek = (d: string) => d >= week && d <= end
  const done = data.tasks.filter((t) => t.status === 'done' && inWeek(day(t.completedAt)))
  const steps = (data.planSteps as PlanStep[]).filter((s) => s.status === 'done' && inWeek(day(s.doneAt)))
  const goals = data.weeklyGoals.filter((g) => reachedGoalIds.includes(g.id))
  const advanced = [
    ...goals.map((g) => ({ key: `g:${g.id}`, text: `Meta cumprida: ${g.title}` })),
    // High priority first, then the most recent.
    ...[...done].sort((a, b) => (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0) || ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1)).map((t) => ({ key: `t:${t.id}`, text: t.title })),
    ...steps.map((s) => ({ key: `s:${s.id}`, text: `Etapa: ${s.title}` })),
  ]
  const until = today < end ? today : end
  const pendingTasks = sortOpenTasks(data.tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate >= week && t.dueDate <= until))
  return {
    advanced: advanced.slice(0, 3),
    pending: pendingTasks.slice(0, 3).map((t) => ({ key: t.id, text: t.title, task: t })),
    advancedTotal: advanced.length,
    pendingTotal: pendingTasks.length,
  }
}
