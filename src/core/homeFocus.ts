/**
 * What Início puts first, right now: one highlight and at most three short lines, from the real records (agenda,
 * tasks, money due). Ordered by what matters at this moment, never repeated, and empty when there is nothing:
 * then the screen stays clean. Pure, so it can be tested without the UI.
 */
import { isEnabled } from '../app/modules'
import { sortOpenTasks } from '../data/selectors'
import type { DataState, Settings, Task } from '../data/types'
import { buildAgenda, itemLabel, tally, type AgendaItem } from './agenda'
import { moneyDueOn, type MoneyDue } from './day'
import { addDaysToDate, nowIn, zoneOf } from './period'
import { awaitingConfirmation, inWords, minutesUntil, nextUp, timeState } from './timeState'

export type FocusTone = 'now' | 'soon' | 'late' | 'today' | 'confirm' | 'money' | 'later'

export interface FocusLine {
  key: string
  tone: FocusTone
  /** Small label above or beside the title ("Agora", "Em 25 min", "Atrasada"…). */
  label: string
  title: string
  detail: string
  target: { kind: 'item'; item: AgendaItem } | { kind: 'task'; task: Task } | { kind: 'money'; money: MoneyDue }
}

export interface HomeFocus {
  lead: FocusLine | null
  lines: FocusLine[]
  /** Checkable things of today: done / total (appointments are not counted). */
  progress: { done: number; total: number }
  /** Nothing pending, nothing coming today. */
  clear: boolean
}

/** How far ahead "em breve" goes for the highlight. */
const SOON_MIN = 120

export function homeFocus(data: DataState, settings: Settings, now = new Date()): HomeFocus {
  const n = nowIn(zoneOf(settings), now)
  const today = n.date
  const items = buildAgenda(data, settings, today, today, now)
  const out: FocusLine[] = []
  const seen = new Set<string>()
  const push = (line: FocusLine) => {
    if (seen.has(line.key)) return
    seen.add(line.key)
    out.push(line)
  }
  const when = (i: AgendaItem) => [itemLabel(i), i.start && (i.end ? `${i.start}–${i.end}` : i.start)].filter(Boolean).join(' · ')

  // 1. What is happening now, or starts soon.
  const next = nextUp(items, today, n.time)
  if (next) {
    const state = timeState(next, today, n.time)
    const until = minutesUntil(next, n.time)
    if (state === 'now') push({ key: next.key, tone: 'now', label: 'Agora', title: next.title, detail: when(next), target: { kind: 'item', item: next } })
    else if (until !== null && until <= SOON_MIN) push({ key: next.key, tone: 'soon', label: inWords(until).replace(/^em/, 'Em'), title: next.title, detail: when(next), target: { kind: 'item', item: next } })
  }

  // 2. Tasks late or due today (most important first).
  if (isEnabled(settings, 'tasks')) {
    const open = data.tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate <= today)
    for (const t of sortOpenTasks(open).slice(0, 3)) {
      const late = t.dueDate < today || (!!t.dueTime && t.dueTime < n.time)
      push({ key: `task:${t.id}`, tone: late ? 'late' : 'today', label: late ? 'Atrasada' : t.dueTime ? `Hoje · ${t.dueTime}` : 'Hoje', title: t.title, detail: t.priority === 'high' ? 'Prioridade alta' : 'Tarefa', target: { kind: 'task', task: t } })
    }
  }

  // 3. What ended and is waiting for a yes/no.
  for (const i of awaitingConfirmation(items, today, n.time).slice(0, 2)) push({ key: i.key, tone: 'confirm', label: 'Confirmar', title: i.title, detail: `${itemLabel(i)}${i.start ? ` · era às ${i.start}` : ''}`, target: { kind: 'item', item: i } })

  // 4. Money due today or tomorrow (a discreet line, never the amount on top).
  const tomorrow = addDaysToDate(today, 1)
  for (const [date, label] of [
    [today, 'Hoje'],
    [tomorrow, 'Amanhã'],
  ] as const) {
    for (const m of moneyDueOn(data, settings, date, now)) push({ key: m.key, tone: 'money', label, title: m.title, detail: m.direction === 'pay' ? 'Você paga' : 'Você recebe', target: { kind: 'money', money: m } })
  }

  // 5. Later today.
  if (next && !seen.has(next.key)) push({ key: next.key, tone: 'later', label: `Às ${next.start}`, title: next.title, detail: itemLabel(next), target: { kind: 'item', item: next } })

  const t = tally(items)
  const lead = out[0] ?? null
  return { lead, lines: out.slice(1, 4), progress: { done: t.done, total: t.total }, clear: !out.length && t.pending === 0 }
}
