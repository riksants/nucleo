import type { Completion, CompletionSource, RoutinePlan } from '../data/types'

export type OccurrenceStatus = 'done' | 'skipped' | 'pending'

/** Fixed id: the same item on the same day is always the same record. */
export function completionId(source: CompletionSource, sourceId: string, date: string): string {
  return `${source}:${sourceId}:${date}`
}

export type CompletionIndex = Map<string, Completion>

const indexCache = new WeakMap<Completion[], { n: number; index: CompletionIndex }>()
/** Built once per version of the list (the store replaces the array on every change). */
export function indexCompletions(list: Completion[]): CompletionIndex {
  const hit = indexCache.get(list)
  if (hit && hit.n === list.length) return hit.index
  const index: CompletionIndex = new Map(list.map((c) => [c.id, c]))
  indexCache.set(list, { n: list.length, index })
  return index
}

export function statusOf(index: CompletionIndex, source: CompletionSource, sourceId: string, date: string): OccurrenceStatus {
  return index.get(completionId(source, sourceId, date))?.status ?? 'pending'
}

/**
 * Routine blocks: new marks are per-day completions; marks made before that
 * (stored inside the plan's `done` map) are still read, never rewritten.
 */
export function routineStatus(index: CompletionIndex, plan: Pick<RoutinePlan, 'done'>, blockId: string, date: string): OccurrenceStatus {
  const c = index.get(completionId('routine', blockId, date))
  if (c) return c.status
  return plan.done[date]?.includes(blockId) ? 'done' : 'pending'
}
