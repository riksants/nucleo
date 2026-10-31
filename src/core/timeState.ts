/**
 * Where an item of the day stands in time, derived from the clock and its own record (nothing stored):
 * Programado → Em horário → Aguardando confirmação, or Concluído / Não realizado once the person says so.
 * The clock passing never makes anything "done": after its time a thing to mark waits for confirmation.
 */
import { isTime, toMinutes } from '../../supabase/functions/_shared/planner/time.ts'
import type { AgendaItem } from './agenda'

export type TimeState = 'scheduled' | 'now' | 'awaiting' | 'done' | 'missed' | 'ended' | 'anytime'

export const TIME_STATE_LABEL: Record<TimeState, string> = {
  scheduled: 'Programado',
  now: 'Em horário',
  awaiting: 'Aguardando confirmação',
  done: 'Concluído',
  missed: 'Não realizado',
  ended: 'Horário encerrado',
  anytime: 'Hoje, a qualquer hora',
}

/** How long something without an end time is considered "in progress" (a task at 14:00, a habit at 18:00). */
export const DEFAULT_MINUTES = 30
/** Appointments without an end. */
const EVENT_MINUTES = 60

/** Can the person mark this item (task, habit, recurring, routine block, a real meal)? */
export function isMarkable(item: AgendaItem): boolean {
  return item.checkable || !!item.markable
}

/** Start and end in minutes of the day, or null for items without a time. */
export function timeWindow(item: AgendaItem): { start: number; end: number } | null {
  if (!isTime(item.start)) return null
  const start = toMinutes(item.start)
  const fallback = start + (item.kind === 'event' ? EVENT_MINUTES : DEFAULT_MINUTES)
  let end = isTime(item.end) ? toMinutes(item.end) : fallback
  // Ends after midnight (sleep 23:00–07:00): treat as lasting to the end of the day.
  if (end <= start) end = 24 * 60
  return { start, end }
}

/**
 * Routine blocks are a plan, not a promise: when their time is over they just read "Horário encerrado", without
 * asking for a confirmation. They stay markable by hand, and nothing is assumed either way.
 */
function asksConfirmation(item: AgendaItem): boolean {
  return isMarkable(item) && item.source.kind !== 'routine'
}

export function timeState(item: AgendaItem, today: string, nowTime: string): TimeState {
  if (item.status === 'done') return 'done'
  if (item.status === 'skipped') return 'missed'
  const markable = asksConfirmation(item)
  if (item.date > today) return 'scheduled'
  const w = timeWindow(item)
  if (item.date < today) return markable ? 'awaiting' : 'ended'
  if (!w) return markable ? 'anytime' : 'scheduled'
  const now = isTime(nowTime) ? toMinutes(nowTime) : 0
  if (now < w.start) return 'scheduled'
  if (now < w.end) return 'now'
  return markable ? 'awaiting' : 'ended'
}

/** Minutes from now to the item's start (negative once started), today only; null without a time. */
export function minutesUntil(item: AgendaItem, nowTime: string): number | null {
  const w = timeWindow(item)
  if (!w || !isTime(nowTime)) return null
  return w.start - toMinutes(nowTime)
}

/** "em 25 min", "em 2 h 10", "agora". */
export function inWords(min: number): string {
  if (min <= 0) return 'agora'
  if (min < 60) return `em ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `em ${h} h ${String(m).padStart(2, '0')}` : `em ${h} h`
}

/** The thing to look at now: what is in progress, else the next one with a time. Appointments count too. */
export function nextUp(items: AgendaItem[], today: string, nowTime: string): AgendaItem | null {
  const live = items.filter((i) => i.date === today)
  const current = live.find((i) => timeState(i, today, nowTime) === 'now')
  if (current) return current
  return live.filter((i) => timeState(i, today, nowTime) === 'scheduled' && timeWindow(i)).sort((a, b) => timeWindow(a)!.start - timeWindow(b)!.start)[0] ?? null
}

/** Items whose time is over and that the person hasn't confirmed yet (today), most recent first. */
export function awaitingConfirmation(items: AgendaItem[], today: string, nowTime: string): AgendaItem[] {
  return items
    .filter((i) => i.date === today && timeState(i, today, nowTime) === 'awaiting')
    .sort((a, b) => (timeWindow(b)?.end ?? 0) - (timeWindow(a)?.end ?? 0))
}

/** "Seu treino estava programado para terminar às 10:30. Você concluiu?" */
export function confirmQuestion(item: AgendaItem): string {
  const end = item.end && isTime(item.end) ? item.end : null
  return end ? `Estava programado até ${end}. Você concluiu?` : item.start ? `Estava programado para ${item.start}. Você fez?` : 'Você fez?'
}
