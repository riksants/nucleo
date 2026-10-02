/**
 * "Reorganizar meu dia / minha semana" and replanning a conflicting item.
 * Pure: they only build a proposal from the current records; nothing is
 * changed until the person confirms. Fixed things never move.
 */
import { isTime, toMinutes } from '../../supabase/functions/_shared/planner/time.ts'
import { newId } from '../data/store'
import type { Completion, DataState, RoutineBlock, RoutinePlan, Settings, Task } from '../data/types'
import { buildAgenda } from './agenda'
import { completionId } from './completions'
import { addDaysToDate, nowIn, weekStart, weekdayOfDate, zoneOf } from './period'
import { activeWindow, busyMinutes, dayBusy, DURATION, findSlot, freeStarts, toTime, WINDOW_LABEL, type Busy } from './timeline'
import { proposalId, type Change, type Proposal } from './assistant/proposal'

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const PRIORITY = { high: 0, medium: 1, low: 2, none: 3 } as const
export const dayName = (date: string, today: string) => (date === today ? 'hoje' : date === addDaysToDate(today, 1) ? 'amanhã' : WEEKDAY[weekdayOfDate(date)])

function taskChange(task: Task, after: Partial<Task>, label: string, detail: string): Change {
  const record = { ...task, ...after }
  return { id: `task:${task.id}`, label, detail, ops: [{ op: 'save', collection: 'tasks', record: record as never, before: task as never }] }
}

/**
 * A routine block can't move without changing the weekly model: that day's
 * occurrence is marked skipped and a task is created at the new time.
 */
export function routineMoveChange(data: DataState, block: RoutineBlock, plan: RoutinePlan, date: string, to: { date: string; start: string }, today: string): Change {
  const skipId = completionId('routine', block.id, date)
  const before = data.completions.find((c) => c.id === skipId) ?? null
  const skip: Completion = { ...(before ?? { createdAt: '', updatedAt: '' }), id: skipId, source: 'routine', sourceId: block.id, date, status: 'skipped' } as Completion
  const task = { id: newId(), title: block.title, projectId: null, dueDate: to.date, dueTime: to.start, priority: 'none', status: 'todo', completedAt: null, notes: `Remarcado da rotina (${dayName(date, today)} ${block.start})`, fromRoutine: { blockId: block.id, date } }
  void plan
  return {
    id: `routine:${block.id}:${date}`,
    label: `${block.title}: ${dayName(date, today)} ${block.start} → ${dayName(to.date, today)} ${to.start}`,
    detail: 'O modelo da rotina não muda: só este dia fica como pulado.',
    ops: [
      { op: 'save', collection: 'completions', record: skip as never, before: before as never },
      { op: 'save', collection: 'tasks', record: task as never, before: null },
    ],
  }
}

const sortTasks = (today: string) => (a: Task, b: Task) => {
  const oa = a.dueDate && a.dueDate < today ? 0 : 1
  const ob = b.dueDate && b.dueDate < today ? 0 : 1
  return oa - ob || PRIORITY[a.priority] - PRIORITY[b.priority] || (a.dueTime || '99').localeCompare(b.dueTime || '99') || a.createdAt.localeCompare(b.createdAt)
}

/** Flexible routine blocks (training, study…) that overlap an appointment on a date. */
function routineClashes(items: ReturnType<typeof buildAgenda>): { block: RoutineBlock; plan: RoutinePlan; date: string; with: string }[] {
  const out: { block: RoutineBlock; plan: RoutinePlan; date: string; with: string }[] = []
  const events = items.filter((i) => i.kind === 'event' && isTime(i.start))
  for (const i of items) {
    if (i.source.kind !== 'routine' || i.source.block.fixed || i.status !== 'pending' || !isTime(i.start)) continue
    const s = toMinutes(i.start)
    const e = isTime(i.end) ? toMinutes(i.end) : s + 60
    const hit = events.find((ev) => ev.date === i.date && toMinutes(ev.start) < e && (isTime(ev.end) ? toMinutes(ev.end) : toMinutes(ev.start) + 60) > s)
    if (hit) out.push({ block: i.source.block, plan: i.source.plan, date: i.date, with: hit.title })
  }
  return out
}

export function reorganizeDay(data: DataState, settings: Settings, now = new Date()): Proposal {
  const n = nowIn(zoneOf(settings), now)
  const today = n.date
  const items = buildAgenda(data, settings, today, today, now)
  const w = activeWindow(data, settings, today)
  // Tasks to place: pending of today, overdue, and up to 3 high-priority without a date.
  const pending = data.tasks.filter((t) => t.status !== 'done' && !t.fromRoutine)
  const candidates = [
    ...pending.filter((t) => t.dueDate && t.dueDate <= today),
    ...pending.filter((t) => !t.dueDate && t.priority === 'high').slice(0, 3),
  ].sort(sortTasks(today))
  const ignore = candidates.map((t) => `task:${t.id}`)
  // The day's agenda is built once; each task only checks the free gaps.
  const busyToday = dayBusy(data, settings, today, now, ignore)
  const placed: { start: number; end: number }[] = []
  const changes: Change[] = []
  const left: string[] = []
  const nowMin = toMinutes(n.time)
  for (const t of candidates) {
    const taken = freeStarts(data, settings, today, DURATION.task, now, [], placed, busyToday)
    // Keep its own time when it is still ahead and free.
    if (t.dueDate === today && isTime(t.dueTime ?? '') && toMinutes(t.dueTime!) > nowMin && taken.includes(toMinutes(t.dueTime!))) {
      placed.push({ start: toMinutes(t.dueTime!), end: toMinutes(t.dueTime!) + DURATION.task })
      continue
    }
    const start = taken[0]
    if (start === undefined) {
      left.push(t.title)
      changes.push(taskChange(t, { dueDate: addDaysToDate(today, 1), dueTime: '' }, `Amanhã · ${t.title}`, 'Não coube hoje'))
      continue
    }
    placed.push({ start, end: start + DURATION.task })
    const was = !t.dueDate ? 'sem data' : t.dueDate < today ? `atrasada (${t.dueDate.slice(8, 10)}/${t.dueDate.slice(5, 7)})` : t.dueTime ? `antes ${t.dueTime}` : 'sem horário'
    changes.push(taskChange(t, { dueDate: today, dueTime: toTime(start) }, `${toTime(start)} · ${t.title}`, was))
  }
  for (const c of routineClashes(items)) {
    const slot = findSlot(data, settings, { from: today, duration: (isTime(c.block.end) ? toMinutes(c.block.end) : 0) - toMinutes(c.block.start) || 60, prefer: c.block.start, ignore: [`routine:${c.block.id}:${today}`], days: 1 }, now)
    if (slot) changes.push(routineMoveChange(data, c.block, c.plan, c.date, slot, today))
  }
  changes.sort((a, b) => a.label.localeCompare(b.label))
  const notes = [`Horários sugeridos conforme ${WINDOW_LABEL[w.source]}. Compromissos e blocos fixos não mudam.`]
  if (left.length) notes.push(`${left.length === 1 ? 'Uma tarefa não coube' : `${left.length} tarefas não couberam`} hoje e ${left.length === 1 ? 'vai' : 'vão'} para amanhã se você aplicar.`)
  return { id: proposalId(), kind: 'batch', title: 'Proposta para hoje', summary: changes.length ? `${changes.length} ${changes.length === 1 ? 'mudança' : 'mudanças'} para o seu dia.` : 'Seu dia já está organizado — nada para mudar.', changes, notes }
}

/** The days of "my week": today → Sunday; on Sunday, the next week. */
export function weekRange(today: string): string[] {
  const start = weekdayOfDate(today) === 0 ? addDaysToDate(today, 1) : today
  const end = addDaysToDate(weekStart(start), 6)
  const out: string[] = []
  for (let d = start; d <= end; d = addDaysToDate(d, 1)) out.push(d)
  return out
}

export function reorganizeWeek(data: DataState, settings: Settings, now = new Date()): Proposal {
  const today = nowIn(zoneOf(settings), now).date
  const days = weekRange(today)
  const last = days[days.length - 1]
  // Capacity per day (minutes free in the window) and current load.
  const cap = new Map(days.map((d) => [d, Math.max(0, activeWindow(data, settings, d).end - activeWindow(data, settings, d).start - busyMinutes(data, settings, d, now))]))
  const load = new Map(days.map((d) => [d, 0]))
  const pending = data.tasks.filter((t) => t.status !== 'done' && !t.fromRoutine)
  // Timed tasks keep their day and time (the person chose it); they still count as load.
  for (const t of pending) if (t.dueDate && load.has(t.dueDate) && isTime(t.dueTime ?? '')) load.set(t.dueDate, load.get(t.dueDate)! + DURATION.task)
  const movable = pending.filter((t) => t.dueDate && t.dueDate <= last && !isTime(t.dueTime ?? '')).sort(sortTasks(today))
  const ratio = (d: string, extra = 0) => (load.get(d)! + extra) / Math.max(cap.get(d)!, 1)
  const changes: Change[] = []
  for (const t of movable) {
    // Allowed: from today until its own date (a date is also a deadline); overdue: any day.
    const allowed = days.filter((d) => t.dueDate! < today || d <= t.dueDate!)
    if (!allowed.length) continue
    const best = allowed.reduce((a, b) => (ratio(b) < ratio(a) ? b : a), allowed[0])
    const own = t.dueDate! >= today && allowed.includes(t.dueDate!) ? t.dueDate! : null
    // Keep the original day unless another one is clearly lighter (about two tasks of difference).
    const target = own && ratio(own) <= ratio(best, DURATION.task * 2) ? own : best
    load.set(target, load.get(target)! + DURATION.task)
    if (target !== t.dueDate) changes.push(taskChange(t, { dueDate: target }, `${dayName(target, today)} · ${t.title}`, t.dueDate! < today ? 'estava atrasada' : `antes: ${dayName(t.dueDate!, today)}`))
  }
  const items = buildAgenda(data, settings, days[0], last, now)
  for (const c of routineClashes(items)) {
    const slot = findSlot(data, settings, { from: c.date, duration: (isTime(c.block.end) ? toMinutes(c.block.end) : 0) - toMinutes(c.block.start) || 60, prefer: c.block.start, ignore: [`routine:${c.block.id}:${c.date}`], days: Math.max(1, days.length - days.indexOf(c.date)) }, now)
    if (slot) changes.push(routineMoveChange(data, c.block, c.plan, c.date, slot, today))
  }
  const w = activeWindow(data, settings, today)
  const notes = [`Distribuí as tarefas sem horário entre ${dayName(days[0], today)} e ${dayName(last, today)}, sem passar do dia marcado em cada uma. Compromissos fixos e tarefas com horário ficam onde estão. Capacidade calculada com ${WINDOW_LABEL[w.source]}.`]
  return { id: proposalId(), kind: 'batch', title: 'Proposta para a semana', summary: changes.length ? `Preparei uma proposta com ${changes.length} ${changes.length === 1 ? 'mudança' : 'mudanças'}.` : 'Sua semana já está equilibrada — nada para mudar.', changes, notes }
}

/** New time for one flexible item in conflict (or that couldn't be done). */
export function replanItem(data: DataState, settings: Settings, b: Pick<Busy, 'item' | 'start' | 'end'>, now = new Date()): Proposal | null {
  const today = nowIn(zoneOf(settings), now).date
  const i = b.item
  const duration = Math.max(STEP_MIN, b.end - b.start)
  const slot = findSlot(data, settings, { from: i.date < today ? today : i.date, duration, prefer: i.start, ignore: [i.key], days: 7, notBefore: { date: i.date, time: i.start } }, now)
  if (!slot) return null
  let change: Change | null = null
  if (i.source.kind === 'task') change = taskChange(i.source.task, { dueDate: slot.date, dueTime: slot.start }, `${i.title}: ${dayName(i.date, today)} ${i.start} → ${dayName(slot.date, today)} ${slot.start}`, 'novo horário livre')
  else if (i.source.kind === 'routine') change = routineMoveChange(data, i.source.block, i.source.plan, i.date, slot, today)
  else if (i.source.kind === 'habit') {
    const h = i.source.habit
    change = { id: `habit:${h.id}`, label: `${h.name}: ${i.start} → ${slot.start} (todos os dias dele)`, detail: 'Muda o horário do hábito', ops: [{ op: 'save', collection: 'habits', record: { ...h, time: slot.start } as never, before: h as never }] }
  }
  if (!change) return null
  return { id: proposalId(), kind: 'update', title: 'Novo horário', summary: `Existe espaço ${dayName(slot.date, today)} às ${slot.start}. Quer mover ${i.title} para esse horário?`, changes: [change], notes: [] }
}

const STEP_MIN = 15
