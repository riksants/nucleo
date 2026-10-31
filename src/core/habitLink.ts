/**
 * A habit linked to what usually proves it (a recurring item, or training/study in the routine). On a day when
 * both happen, the day shows one line: the linked item, with the habit attached. Nothing is copied and nothing
 * is marked by the clock: marking the line suggests the habit (or marks it, when the person chose so).
 */
import { isEnabled } from '../app/modules'
import type { DataState, Habit, RoutinePlan, Settings } from '../data/types'
import { recurringOn } from './habits'
import { occursOn } from './recurrence'
import { weekdayOfDate, zoneOf } from './period'
import { wallClock } from '../lib/zoned'

/** Agenda key of the item that hosts the habit on `date`, or null (the habit then shows on its own). */
export function habitHostOn(data: Pick<DataState, 'recurring' | 'routinePlans'>, settings: Settings, habit: Habit, date: string): string | null {
  const link = habit.link
  if (!link || !habit.active || !occursOn(habit.rule, habit.startDate, date)) return null
  if (link.kind === 'recurring') {
    if (!isEnabled(settings, 'recurring')) return null
    const r = data.recurring.find((x) => x.id === link.id)
    return r && r.active && recurringOn(r, date) ? `recurring:${r.id}:${date}` : null
  }
  if (!isEnabled(settings, 'routine')) return null
  const plan = data.routinePlans.find((p) => p.id === 'routine-current') as RoutinePlan | undefined
  if (plan?.createdAt && date < wallClock(new Date(plan.createdAt), zoneOf(settings)).date) return null
  const day = weekdayOfDate(date)
  const block = plan?.blocks.filter((b) => b.day === day && b.kind === link.blockKind).sort((a, b) => a.start.localeCompare(b.start))[0]
  return block ? `routine:${block.id}:${date}` : null
}

/** Short description for the form and the line ("Estudar inglês (recorrente)", "Treino da rotina"). */
export function linkLabel(data: Pick<DataState, 'recurring'>, link: Habit['link']): string {
  if (!link) return ''
  if (link.kind === 'recurring') return data.recurring.find((r) => r.id === link.id)?.title ?? 'Recorrente removido'
  return link.blockKind === 'training' ? 'Treino da rotina' : 'Estudo da rotina'
}
