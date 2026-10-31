/**
 * "Desfazer importação", in one write:
 * - movements created by this import are removed — only while still exactly as imported (an edit by
 *   the person afterwards keeps it, and says so);
 * - what rules did because of those movements (reservations, tasks…) is undone with them, with the
 *   usual protections (a task edited later stays);
 * - movements that already existed and were only confirmed (reconciled) stay — only the link goes;
 * - nothing else is touched: a movement of another import or typed by hand is never removed.
 * The import stays in the history, marked undone, with what was kept and why.
 */
import type { BatchOp } from '../../data/repository'
import type { AutomationRun, DataState, Transaction } from '../../data/types'
import { runPut } from '../automation/types'
import { undoRun } from '../automation/undo'
import { applyOps } from '../rules/work'
import { bankFp } from './plan'

export interface UndoImportResult {
  ops: BatchOp[]
  removed: number
  unlinked: number
  rules: number
  kept: { id: string; label: string; why: string }[]
}

export const canUndoImport = (run: AutomationRun) => run.automation === 'bankImport' && run.status === 'done' && !run.bankImport?.undone

export function undoImport(run: AutomationRun, data: DataState, today: string, now = new Date()): UndoImportResult | null {
  if (!canUndoImport(run)) return null
  const mine = data.transactions.filter((t) => t.bank?.importId === run.id)
  const created = mine.filter((t) => !t.bank!.reconciled)
  const reconciled = mine.filter((t) => t.bank!.reconciled)
  const createdIds = new Set(created.map((t) => t.id))
  const runsOf = new Map<string, AutomationRun[]>()
  for (const r of data.automationRuns) {
    if (r.automation !== 'rule' || r.status !== 'done' || !r.cause?.txId || !createdIds.has(r.cause.txId)) continue
    ;(runsOf.get(r.cause.txId) ?? runsOf.set(r.cause.txId, []).get(r.cause.txId)!).push(r)
  }

  let state = data
  const ops: BatchOp[] = []
  const kept: UndoImportResult['kept'] = []
  let removed = 0
  let rules = 0
  const asImported = (t: Transaction | undefined) => Boolean(t?.bank?.fp && bankFp(t) === t.bank.fp)
  for (const tx of created) {
    const linked = runsOf.get(tx.id) ?? []
    if (!linked.length) {
      if (asImported(tx)) {
        ops.push({ op: 'remove', collection: 'transactions', id: tx.id })
        removed++
      } else kept.push({ id: tx.id, label: tx.reason, why: 'editada depois da importação' })
      continue
    }
    // The rules' undos first (each sees what the previous left): a category a rule gave goes back too.
    let trial = state
    const ruleOps: BatchOp[] = []
    for (const r of linked) {
      const u = undoRun(r, trial, today)
      ruleOps.push(...u.ops)
      trial = applyOps(trial, u.ops)
    }
    if (asImported(trial.transactions.find((t) => t.id === tx.id))) {
      ops.push(...ruleOps, { op: 'remove', collection: 'transactions', id: tx.id })
      state = trial
      removed++
      rules += linked.length
    } else kept.push({ id: tx.id, label: tx.reason, why: 'editada depois da importação' })
  }
  for (const tx of reconciled) {
    const { bank: _b, ...rest } = tx
    void _b
    ops.push({ op: 'put', collection: 'transactions', item: rest as Transaction })
  }
  // Etapa 4: the other side of a transfer, marked by this import, goes back — only if still as the import left it.
  for (const ch of run.changed) {
    if (ch.collection !== 'transactions' || ch.field !== 'transfer') continue
    const tx = state.transactions.find((t) => t.id === ch.id)
    if (!tx) continue
    if (JSON.stringify(tx.transfer) !== JSON.stringify(ch.after)) {
      kept.push({ id: tx.id, label: tx.reason, why: 'a marca de transferência foi alterada depois' })
      continue
    }
    const next = { ...tx } as Transaction
    if (ch.before === undefined) delete next.transfer
    else next.transfer = ch.before as Transaction['transfer']
    ops.push({ op: 'put', collection: 'transactions', item: next })
  }
  const info = run.bankImport!
  const result = { removed, unlinked: reconciled.length, rules, kept }
  ops.push(runPut({ ...run, status: 'undone', bankImport: { ...info, undone: { at: now.toISOString(), ...result } } }))
  return { ops, ...result }
}
