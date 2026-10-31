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

type Created = AutomationRun['created'][number]
type Changed = AutomationRun['changed'][number]

/** A write made by hand long after the run (older runs carry no fingerprint): beyond this, the record counts as edited. */
const LEGACY_SLACK_MS = 60_000

/**
 * The category a rule put on a movement (and nobody changed since): left out when comparing, so a
 * categorization rule that ran in the same write never makes the movement look "edited by the person".
 */
function ruleCategory(data: DataState, item: Entity): { found: boolean; before: unknown } {
  const cat = (item as { category?: unknown }).category
  if (cat === undefined) return { found: false, before: undefined }
  for (const r of data.automationRuns) {
    if (r.automation !== 'rule' || r.status !== 'done') continue
    const ch = r.changed.find((c) => c.collection === 'transactions' && c.id === item.id && c.field === 'category' && c.after === cat && !(c.action !== undefined && r.actions?.[c.action]?.undone))
    if (ch) return { found: true, before: ch.before }
  }
  return { found: false, before: undefined }
}

/**
 * Was a record created by this run changed afterwards (by the person, another device…)? With a
 * fingerprint: any difference except a rule's category. Without one (runs before Etapa 4): a write
 * clearly after the run's own last write. In doubt the record is kept — undo never deletes an edit.
 */
export function editedSince(c: Created, item: Entity, run: AutomationRun, data: DataState): boolean {
  if (c.fp !== undefined) {
    if (fingerprint(item) === c.fp) return false
    const rc = ruleCategory(data, item)
    if (!rc.found) return true
    const bare: Record<string, unknown> = { ...item }
    if (rc.before === undefined) delete bare.category
    else bare.category = rc.before
    return fingerprint(bare) !== c.fp
  }
  // Rules always wrote fingerprints; only the payments of Parte 1 come here.
  if (run.automation === 'rule') return false
  const at = Date.parse(item.updatedAt)
  const ref = Date.parse(run.updatedAt)
  return Number.isFinite(at) && Number.isFinite(ref) && at - ref > LEGACY_SLACK_MS
}

/**
 * Puts back what `created`/`changed` did, with every protection: a created record edited later stays;
 * a field changed later stays; a goal loses exactly the reserved amount. `touched` collects the
 * records to write (each edited once).
 */
function revert(run: AutomationRun, created: Created[], changed: Changed[], data: DataState, today: string, touched: Map<string, { collection: CollectionName; item: Record<string, unknown> }>) {
  const ops: BatchOp[] = []
  let partial = false
  const find = (collection: CollectionName, id: string) => (data[collection] as Entity[]).find((x) => x.id === id)
  for (const c of created) {
    const item = find(c.collection, c.id)
    if (!item) continue
    if (editedSince(c, item, run, data)) partial = true
    else ops.push({ op: 'remove', collection: c.collection, id: c.id })
  }
  const record = (collection: CollectionName, id: string) => {
    const key = `${collection}:${id}`
    if (!touched.has(key)) {
      const item = find(collection, id)
      if (!item) return null
      touched.set(key, { collection, item: { ...item } })
    }
    return touched.get(key)!.item
  }
  for (const ch of changed) {
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
  /** Ids of the created records that undo removes (the others were edited and stay). */
  const removed = new Set(ops.filter((o) => o.op === 'remove').map((o) => (o as { id: string }).id))
  return { ops, partial, record, removed }
}

/** A subscriber's payment goes only together with its income (an edited income keeps both). */
function dropPayment(run: AutomationRun, removed: Set<string>, record: (c: CollectionName, id: string) => Record<string, unknown> | null, data: DataState): boolean {
  if (run.automation !== 'subscriberCharge' || run.status !== 'done') return false
  const income = run.created.find((c) => c.collection === 'transactions')
  const stays = income && !removed.has(income.id) && (data.transactions as Entity[]).some((t) => t.id === income.id)
  if (stays) return true
  const s = record('subscribers', run.origin.id) as unknown as Subscriber | null
  if (s) s.payments = s.payments.filter((p) => p.id !== run.id)
  return false
}

/** An entry of an action already undone alone is never undone a second time. */
const stillApplied = (run: AutomationRun) => (e: { action?: number }) => e.action === undefined || !run.actions?.[e.action]?.undone

export function undoRun(run: AutomationRun, data: DataState, today: string, nextStatus: 'undone' | 'skipped' = 'undone'): { ops: BatchOp[]; partial: boolean } {
  const touched = new Map<string, { collection: CollectionName; item: Record<string, unknown> }>()

  // A confirmation undone: the money goes, the charge stays "A receber"/"A pagar" (the cycle happened).
  if (run.fromPending) {
    const { ops, record, removed, partial } = revert(run, run.created, [], data, today, touched)
    dropPayment(run, removed, record, data)
    // The person edited the money after confirming: nothing is undone (the edit is never lost).
    if (partial) return { ops: [], partial: true }
    for (const { collection, item } of touched.values()) ops.push({ op: 'put', collection, item: item as unknown as Entity } as BatchOp)
    const { fromPending: _f, ...rest } = run
    void _f
    const summary = run.automation === 'subscriberCharge' ? `Cobrança de ${run.origin.label}: a receber` : `${run.origin.label}: a pagar`
    ops.push(runPut({ ...rest, status: 'pending', summary, created: [] }))
    return { ops, partial: false }
  }

  const keep = stillApplied(run)
  const { ops, partial, record, removed } = revert(run, run.created.filter(keep), run.changed.filter(keep), data, today, touched)
  dropPayment(run, removed, record, data)
  for (const { collection, item } of touched.values()) ops.push({ op: 'put', collection, item: item as unknown as Entity } as BatchOp)
  ops.push(runPut({ ...run, status: nextStatus }))
  return { ops, partial }
}

/** Can this one action of a rule run be undone alone? (Runs before 2.1 don't know which record came from which action.) */
export function canUndoAction(run: AutomationRun, i: number): boolean {
  const a = run.actions?.[i]
  if (run.automation !== 'rule' || run.status !== 'done' || !a?.ok || a.undone) return false
  return [...run.created, ...run.changed].some((e) => e.action === i)
}

/**
 * "Desfazer só esta ação": the same protections as undoing everything, only for the records of
 * action `i`. When every action that was done is undone, the run becomes undone.
 */
export function undoAction(run: AutomationRun, i: number, data: DataState, today: string): { ops: BatchOp[]; partial: boolean } | null {
  if (!canUndoAction(run, i)) return null
  const touched = new Map<string, { collection: CollectionName; item: Record<string, unknown> }>()
  const mine = (e: { action?: number }) => e.action === i
  const { ops, partial } = revert(run, run.created.filter(mine), run.changed.filter(mine), data, today, touched)
  for (const { collection, item } of touched.values()) ops.push({ op: 'put', collection, item: item as unknown as Entity } as BatchOp)
  const actions = run.actions!.map((a, k) => (k === i ? { ...a, undone: true } : a))
  const allUndone = actions.every((a) => !a.ok || a.undone)
  ops.push(runPut({ ...run, actions, status: allUndone ? 'undone' : run.status }))
  return { ops, partial }
}
