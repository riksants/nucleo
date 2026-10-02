/**
 * The only way the daily screens change data. Morning, Night, Agenda, Habits,
 * Recurring and Focus all call these, and every action writes to the original
 * record (task, completion, routine plan) — so all screens agree.
 */
import { useCallback } from 'react'
import { useStore } from '../data/store'
import type { CompletionSource, MealEntry, RoutinePlan, Task } from '../data/types'
import { completionId } from './completions'

export function useDailyActions() {
  const { data, save, remove } = useStore()

  /** done / skipped, or null to clear the mark of that day. */
  const setCompletion = useCallback(
    async (source: CompletionSource, sourceId: string, date: string, status: 'done' | 'skipped' | null) => {
      const id = completionId(source, sourceId, date)
      const existing = data.completions.find((c) => c.id === id)
      if (status === null) {
        if (existing) await remove('completions', id)
        return
      }
      await save('completions', { ...existing, id, source, sourceId, date, status })
    },
    [data.completions, save, remove],
  )

  const completeTask = useCallback(
    (task: Task, done: boolean) => save('tasks', { ...task, status: done ? 'done' : 'todo', completedAt: done ? (task.completedAt ?? new Date().toISOString()) : null }),
    [save],
  )

  /** "Amanhã" and "Reagendar": the task keeps everything, only the date changes. */
  const moveTask = useCallback((task: Task, date: string) => save('tasks', { ...task, dueDate: date }), [save])

  /** "Tirar da data": stays pending, without a date (nothing is deleted). */
  const clearTaskDate = useCallback((task: Task) => save('tasks', { ...task, dueDate: '', dueTime: '' }), [save])

  /**
   * Routine block on a day. Older marks live in the plan's `done` map; unmarking
   * one of those removes it from the map once, then completions take over.
   */
  const setRoutine = useCallback(
    async (plan: RoutinePlan, blockId: string, date: string, done: boolean) => {
      const legacy = plan.done[date]?.includes(blockId)
      if (!done && legacy) await save('routinePlans', { ...plan, done: { ...plan.done, [date]: plan.done[date].filter((x) => x !== blockId) } })
      await setCompletion('routine', blockId, date, done ? 'done' : null)
    },
    [save, setCompletion],
  )

  /** A real meal is marked on its own record (one source of truth). */
  const setMealDone = useCallback((meal: MealEntry, done: boolean) => save('meals', { ...meal, done, doneAt: done ? (meal.doneAt ?? new Date().toISOString()) : null }), [save])

  return { setCompletion, completeTask, moveTask, clearTaskDate, setRoutine, setMealDone }
}
