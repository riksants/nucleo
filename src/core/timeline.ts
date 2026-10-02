/**
 * Time on a day, built from the Agenda (Etapa 1) — nothing new is stored.
 * Used to detect conflicts and to find free time. Rules:
 * - appointments and fixed routine blocks are fixed; meals are kept in place;
 * - tasks, habits, recurring and non-fixed routine blocks (training, study…) are flexible;
 * - items without an end get a short default duration (task 30, habit 15, meal 30).
 */
import { isTime, toMinutes } from '../../supabase/functions/_shared/planner/time.ts'
import type { DataState, Settings } from '../data/types'
import { buildAgenda, type AgendaItem } from './agenda'
import { addDaysToDate, nowIn, weekdayOfDate, zoneOf } from './period'

export const DEFAULT_ACTIVE = { start: '07:00', end: '22:00' }
export const DURATION = { task: 30, habit: 15, meal: 30, recurring: 15, event: 60 }
export const STEP = 15

export interface Busy {
  key: string
  date: string
  start: number
  end: number
  title: string
  item: AgendaItem
  fixed: boolean
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const toTime = hhmm

/** Is this agenda item fixed (never moved by a proposal)? */
export function isFixed(i: AgendaItem): boolean {
  if (i.kind === 'event' || i.kind === 'meal') return true
  if (i.source.kind === 'routine') return i.source.block.fixed
  return false
}

/** Timed items as minute intervals. Done tasks and skipped items no longer take time. */
export function busyOf(items: AgendaItem[]): Busy[] {
  const out: Busy[] = []
  for (const i of items) {
    if (!isTime(i.start) || i.status === 'skipped') continue
    if (i.kind === 'task' && i.status === 'done') continue
    const start = toMinutes(i.start)
    const own = isTime(i.end) ? toMinutes(i.end) : 0
    const fallback = i.kind === 'event' ? DURATION.event : i.kind === 'habit' ? DURATION.habit : i.kind === 'meal' ? DURATION.meal : i.kind === 'recurring' ? DURATION.recurring : DURATION.task
    const end = own > start ? own : start + fallback
    out.push({ key: i.key, date: i.date, start, end, title: i.title, item: i, fixed: isFixed(i) })
  }
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.start - b.start || a.end - b.end))
}

export type WindowSource = 'settings' | 'routine' | 'default'

/** The hours used to suggest times: settings → routine questionnaire → 07:00–22:00. */
export function activeWindow(data: Pick<DataState, 'plannerProfiles'>, settings: Settings, date: string): { start: number; end: number; source: WindowSource } {
  const a = settings.activeHours
  if (a && isTime(a.start) && isTime(a.end) && toMinutes(a.end) > toMinutes(a.start)) return { start: toMinutes(a.start), end: toMinutes(a.end), source: 'settings' }
  const r = data.plannerProfiles.find((p) => p.id === 'planner-profile')?.routine
  if (r) {
    const weekend = [0, 6].includes(weekdayOfDate(date))
    const wake = weekend ? r.wakeWeekend : r.wakeWeekday
    const sleep = weekend ? r.sleepWeekend : r.sleepWeekday
    // Awake time, leaving a little room after waking and before sleeping.
    if (isTime(wake) && isTime(sleep) && toMinutes(sleep) > toMinutes(wake) + 120) return { start: toMinutes(wake) + 30, end: toMinutes(sleep) - 30, source: 'routine' }
  }
  return { start: toMinutes(DEFAULT_ACTIVE.start), end: toMinutes(DEFAULT_ACTIVE.end), source: 'default' }
}

export const WINDOW_LABEL: Record<WindowSource, string> = {
  settings: 'sua faixa de horário (Configurações)',
  routine: 'os horários da sua rotina',
  default: 'a faixa padrão de 07:00 a 22:00 (ajustável em Configurações)',
}

export type ConflictLevel = 'high' | 'medium'

export interface Conflict {
  key: string
  date: string
  a: Busy
  b: Busy
  level: ConflictLevel
}

const important = (b: Busy) => b.item.source.kind === 'task' && b.item.source.task.priority === 'high'

/**
 * Overlaps worth telling: an appointment with anything; a fixed routine block
 * with a task, training or study; two high-priority tasks. Habit vs habit and
 * other trivial overlaps are ignored. Meals only count against appointments.
 */
export function conflictsOf(items: AgendaItem[]): Conflict[] {
  const busy = busyOf(items)
  const out: Conflict[] = []
  for (let x = 0; x < busy.length; x++) {
    for (let y = x + 1; y < busy.length; y++) {
      const a = busy[x]
      const b = busy[y]
      if (a.date !== b.date || b.start >= a.end) break
      const kinds = [a.item.kind, b.item.kind]
      let level: ConflictLevel | null = null
      if (kinds.includes('event')) {
        const other = a.item.kind === 'event' ? b : a
        level = other.item.kind === 'habit' || other.item.kind === 'recurring' ? 'medium' : 'high'
      } else if (kinds.includes('meal')) level = null
      else if ((a.fixed && !b.fixed) || (!a.fixed && b.fixed)) {
        const flex = a.fixed ? b : a
        if (flex.item.kind === 'task' || flex.item.kind === 'routine') level = 'medium'
      } else if (important(a) && important(b)) level = 'medium'
      if (!level) continue
      out.push({ key: `conflict:${a.date}:${[a.key, b.key].sort().join('|')}`, date: a.date, a, b, level })
    }
  }
  return out
}

/** Busy intervals of a day (optionally ignoring the item being moved). */
export function dayBusy(data: DataState, settings: Settings, date: string, now: Date, ignore: string[] = []): Busy[] {
  return busyOf(buildAgenda(data, settings, date, date, now)).filter((b) => !ignore.includes(b.key))
}

/** Free starting minutes for `duration` on a day: inside the window, never in the past. */
export function freeStarts(data: DataState, settings: Settings, date: string, duration: number, now: Date, ignore: string[] = [], extraBusy: { start: number; end: number }[] = []): number[] {
  const n = nowIn(zoneOf(settings), now)
  if (date < n.date) return []
  const w = activeWindow(data, settings, date)
  const busy = [...dayBusy(data, settings, date, now, ignore), ...extraBusy]
  // Today: from now + 15 min, rounded up to the next step.
  const earliest = date === n.date ? Math.ceil((toMinutes(n.time) + STEP) / STEP) * STEP : w.start
  const out: number[] = []
  for (let s = Math.max(w.start, earliest); s + duration <= w.end; s += STEP) {
    if (busy.every((b) => s + duration <= b.start || s >= b.end)) out.push(s)
  }
  return out
}

export interface Slot {
  date: string
  start: string
}

/**
 * First day (from `from`, up to `days` days) with room, choosing the start
 * closest to `prefer` ("HH:MM") on that day. null when nothing fits.
 */
export function findSlot(data: DataState, settings: Settings, opts: { from: string; duration: number; prefer?: string; ignore?: string[]; days?: number; notBefore?: { date: string; time: string } }, now = new Date()): Slot | null {
  const days = opts.days ?? 7
  const prefer = opts.prefer && isTime(opts.prefer) ? toMinutes(opts.prefer) : null
  for (let i = 0; i < days; i++) {
    const date = addDaysToDate(opts.from, i)
    let starts = freeStarts(data, settings, date, opts.duration, now, opts.ignore)
    if (opts.notBefore && date === opts.notBefore.date) starts = starts.filter((s) => s >= toMinutes(opts.notBefore!.time))
    if (!starts.length) continue
    const pick = prefer === null ? starts[0] : starts.reduce((best, s) => (Math.abs(s - prefer) < Math.abs(best - prefer) ? s : best), starts[0])
    return { date, start: hhmm(pick) }
  }
  return null
}

/** Minutes of the window already taken (fixed + flexible timed items). */
export function busyMinutes(data: DataState, settings: Settings, date: string, now: Date): number {
  const w = activeWindow(data, settings, date)
  let total = 0
  for (const b of dayBusy(data, settings, date, now)) total += Math.max(0, Math.min(b.end, w.end) - Math.max(b.start, w.start))
  return total
}
