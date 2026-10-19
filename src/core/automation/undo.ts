/**
 * Undoing a run, in one device transaction:
 * - the records it created are removed (income/expense; for a subscriber, its payment too);
 * - each field it changed goes back only if it still holds what the automation wrote — a later
 *   edit by the person is kept (`partial` tells the screen);
 * - a goal loses exactly the amount of that run (money saved by hand afterwards stays);
 * - rules: a task/note/Inbox item it created is removed only while still exactly as it was created
 *   (edited or completed by the person → it stays, `partial`); a field it cleared comes back empty;
 * - the run stays, marked undone (or skipped), so it is never done again.
 */
import type { AutomationRun, CollectionName, DataState, Entity, FinanceGoal, Subscriber } from '../../data/types'
import { withSaved } from '../financeGoals'
import { fingerprint } from '../rules/actions'
import { type BatchOp, runPut } from './types'

/** Rule runs caused by a movement this run created (undoing it offers to undo them too). */
export function linkedRuleRuns(run: AutomationRun, runs: AutomationRun[]): AutomationRun[] {
  const txs = new Set(run.created.filter((c) => c.collection === 'transactions').map((c) => c.id))
  if (!txs.size) return []
  return runs.filter((r) => r.automation === 'rule' && r.status === 'done' && r.cause?.txId && txs.has(r.cause.txId))
}

export function undoRun(run: AutomationRun, data: DataState, today: string, nextStatus: 'undone' | 'skipped' = 'undone'): { ops: BatchOp[]; partial: boolean } {
  const ops: BatchOp[] = []
  let partial = false
  const find = (collection: CollectionName, id: string) => (data[collection] as Entity[]).find((x) => x.id === id)
  for (const c of run.created) {
    const item = find(c.collection, c.id)
    if (!item) continue
    if (c.fp !== undefined && fingerprint(item) !== c.fp) partial = true
    else ops.push({ op: 'remove', collection: c.collection, id: c.id })
  }

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

  // A confirmation undone: the money goes, the charge stays "A receber"/"A pagar" (the cycle happened).
  if (run.fromPending) {
    for (const { collection, item } of touched.values()) ops.push({ op: 'put', collection, item: item as unknown as Entity } as BatchOp)
    const { fromPending: _f, ...rest } = run
    void _f
    const summary = run.automation === 'subscriberCharge' ? `Cobrança de ${run.origin.label}: a receber` : `${run.origin.label}: a pagar`
    ops.push(runPut({ ...rest, status: 'pending', summary, created: [] }))
    return { ops, partial: false }
  }

  for (const ch of run.changed) {
    const item = record(ch.collection, ch.id)
    if (!item) continue
    if (ch.collection === 'financeGoals' && ch.field === 'saved' && (ch.delta !== undefined || run.automation === 'goalSave')) {
      const g = item as unknown as FinanceGoal
      const saved = Math.max(0, g.saved - (ch.delta ?? run.amount ?? 0))
      g.history = withSaved(g, saved, today)
      g.saved = saved
    } else if (item[ch.field] === ch.after) {
      if (ch.before === undefined) delete item[ch.field]
      else item[ch.field] = ch.before
    } else partial = true
  }

  for (const { collection, item } of touched.values()) ops.push({ op: 'put', collection, item: item as unknown as Entity } as BatchOp)
  ops.push(runPut({ ...run, status: nextStatus }))
  return { ops, partial }
}
