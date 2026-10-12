/**
 * Undoing a run, in one device transaction:
 * - the records it created are removed (income/expense; for a subscriber, its payment too);
 * - each field it changed goes back only if it still holds what the automation wrote — a later
 *   edit by the person is kept (`partial` tells the screen);
 * - a goal loses exactly the amount of that run (money saved by hand afterwards stays);
 * - the run stays, marked undone (or skipped), so it is never done again.
 */
import type { AutomationRun, CollectionName, DataState, Entity, FinanceGoal, Subscriber } from '../../data/types'
import { withSaved } from '../financeGoals'
import { type BatchOp, runPut } from './types'

export function undoRun(run: AutomationRun, data: DataState, today: string, nextStatus: 'undone' | 'skipped' = 'undone'): { ops: BatchOp[]; partial: boolean } {
  const ops: BatchOp[] = []
  let partial = false
  const exists = (collection: CollectionName, id: string) => (data[collection] as Entity[]).some((x) => x.id === id)
  for (const c of run.created) if (exists(c.collection, c.id)) ops.push({ op: 'remove', collection: c.collection, id: c.id })

  // Every record touched, edited once and written once.
  const touched = new Map<string, { collection: CollectionName; item: Record<string, unknown> }>()
  const record = (collection: CollectionName, id: string) => {
    const key = `${collection}:${id}`
    if (!touched.has(key)) {
      const item = (data[collection] as Entity[]).find((x) => x.id === id)
      if (!item) return null
      touched.set(key, { collection, item: { ...item } })
    }
    return touched.get(key)!.item
  }

  if (run.automation === 'subscriberCharge' && run.status === 'done') {
    const s = record('subscribers', run.origin.id) as unknown as Subscriber | null
    if (s) s.payments = s.payments.filter((p) => p.id !== run.id)
  }

  for (const ch of run.changed) {
    const item = record(ch.collection, ch.id)
    if (!item) continue
    if (run.automation === 'goalSave' && ch.field === 'saved') {
      const g = item as unknown as FinanceGoal
      const saved = Math.max(0, g.saved - (run.amount ?? 0))
      g.history = withSaved(g, saved, today)
      g.saved = saved
    } else if (item[ch.field] === ch.after) item[ch.field] = ch.before
    else partial = true
  }

  for (const { collection, item } of touched.values()) ops.push({ op: 'put', collection, item: item as unknown as Entity } as BatchOp)
  ops.push(runPut({ ...run, status: nextStatus }))
  return { ops, partial }
}
