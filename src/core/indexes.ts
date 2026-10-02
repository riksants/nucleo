/**
 * Lookups by date, built once per version of a list (the store replaces the
 * array on every change, so the array itself is the cache key). They turn
 * "scan every task/appointment/meal for each day" into a direct lookup, which
 * matters for people with years of history. Nothing here is stored.
 */
import type { CalendarEvent, Completion, MealEntry, Task, Transaction } from '../data/types'
import { wallClock } from '../lib/zoned'

/** Cached per list; also rebuilt if the same array changed size (defensive: the app never mutates in place). */
function byKey<T>(cache: WeakMap<T[], { n: number; m: Map<string, T[]> }>, list: T[], key: (x: T) => string | undefined): Map<string, T[]> {
  const hit = cache.get(list)
  if (hit && hit.n === list.length) return hit.m
  const m = new Map<string, T[]>()
  for (const x of list) {
    const k = key(x)
    if (!k) continue
    const bucket = m.get(k)
    if (bucket) bucket.push(x)
    else m.set(k, [x])
  }
  cache.set(list, { n: list.length, m })
  return m
}

const tasksCache = new WeakMap<Task[], { n: number; m: Map<string, Task[]> }>()
/** Tasks by their date ("YYYY-MM-DD"), in list order. */
export const tasksByDate = (tasks: Task[]) => byKey(tasksCache, tasks, (t) => t.dueDate || undefined)

const eventsCache = new WeakMap<CalendarEvent[], { n: number; m: Map<string, CalendarEvent[]> }>()
export const eventsByDate = (events: CalendarEvent[]) => byKey(eventsCache, events, (e) => e.date || undefined)

const mealsCache = new WeakMap<MealEntry[], { n: number; m: Map<string, MealEntry[]> }>()
export const mealsByDate = (meals: MealEntry[]) => byKey(mealsCache, meals, (m) => m.date || undefined)

const completionsCache = new WeakMap<Completion[], { n: number; m: Map<string, Completion[]> }>()
export const completionsByDate = (list: Completion[]) => byKey(completionsCache, list, (c) => c.date || undefined)

const doneCache = new WeakMap<Task[], { n: number; z: Map<string, Map<string, number>> }>()
/** How many tasks were completed on each day, in the zone. */
export function tasksCompletedByDay(tasks: Task[], tz: string): Map<string, number> {
  let entry = doneCache.get(tasks)
  if (entry && entry.n !== tasks.length) entry = undefined
  const hit = entry?.z.get(tz)
  if (hit) return hit
  const m = new Map<string, number>()
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completedAt) continue
    const day = dayOf(t.completedAt, tz)
    m.set(day, (m.get(day) ?? 0) + 1)
  }
  if (!entry) doneCache.set(tasks, (entry = { n: tasks.length, z: new Map() }))
  entry.z.set(tz, m)
  return m
}

/**
 * Calendar day of an instant in a zone, remembered per instant+zone: the same
 * timestamps (createdAt, completedAt) are converted again and again otherwise.
 */
const dayMemo = new Map<string, string>()
export function dayOf(iso: string, tz: string): string {
  const k = `${tz}|${iso}`
  let d = dayMemo.get(k)
  if (d === undefined) {
    d = wallClock(new Date(iso), tz).date
    if (dayMemo.size > 200_000) dayMemo.clear()
    dayMemo.set(k, d)
  }
  return d
}

/** Day of a money movement (same rule as before: the day it was registered, in the zone). */
export const dayOfTransaction = (t: Pick<Transaction, 'createdAt'>, tz: string) => dayOf(t.createdAt, tz)
