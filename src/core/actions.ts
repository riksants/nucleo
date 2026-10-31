/**
 * The only way the daily screens change data. Morning, Night, Agenda, Habits,
 * Recurring and Focus all call these, and every action writes to the original
 * record (task, completion, routine plan) — so all screens agree.
 */
import { useCallback } from 'react'
import { useStore } from '../data/store'
import type { Completion, CompletionSource, MealEntry, RoutinePlan, Task } from '../data/types'
import { completionId } from './completions'
import { blocksBackedBy, ROUTINE_ID } from './routine'

export function useDailyActions() {
  const { data, save, remove } = useStore()

  /** done / skipped, or null to clear the mark of that day. `via`: marked together with that item (a linked habit). */
  const setCompletion = useCallback(
    async (source: CompletionSource, sourceId: string, date: string, status: 'done' | 'skipped' | null, via?: string) => {
      const id = completionId(source, sourceId, date)
      const existing = data.completions.find((c) => c.id === id)
      if (status === null) {
        if (existing) await remove('completions', id)
        // What was marked from this record (a routine block backed by this habit) goes back too.
        for (const c of data.completions) if (c.via === id && c.id !== id) await remove('completions', c.id)
        return
      }
      const { via: _was, ...rest } = existing ?? ({} as Partial<Completion>)
      await save('completions', { ...rest, id, source, sourceId, date, status, ...(via ? { via } : {}) })
      // A habit marked done (by hand or by a focus session that reached its goal) is a real record: with
      // "Marcar a rotina com registros" on, the routine block it backs that day is marked too, with its origin.
      if (source === 'habit' && status === 'done' && !via?.startsWith('routine:')) {
        const plan = data.routinePlans.find((p) => p.id === ROUTINE_ID)
        const habit = data.habits.find((h) => h.id === sourceId)
        if (plan?.autoFromEvidence && habit) {
          for (const b of blocksBackedBy(plan, habit, date, data.completions)) await save('completions', { id: completionId('routine', b.id, date), source: 'routine', sourceId: b.id, date, status: 'done', via: id })
        }
      }
    },
    [data.completions, data.routinePlans, data.habits, save, remove],
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
