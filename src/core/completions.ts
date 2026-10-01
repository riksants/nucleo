import type { Completion, CompletionSource, RoutinePlan } from '../data/types'

export type OccurrenceStatus = 'done' | 'skipped' | 'pending'

/** Fixed id: the same item on the same day is always the same record. */
export function completionId(source: CompletionSource, sourceId: string, date: string): string {
  return `${source}:${sourceId}:${date}`
}

export type CompletionIndex = Map<string, Completion>

export function indexCompletions(list: Completion[]): CompletionIndex {
  return new Map(list.map((c) => [c.id, c]))
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
