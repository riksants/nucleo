/**
 * The writes that saving a sale or a project produces, as pure functions: the record itself, the
 * incomes of its payments in Financeiro (data/receipts) and, for projects, the client automation.
 *
 * Extracted from useReceipts (unchanged behaviour) so the Assistant applies a plan through exactly the
 * same path as the Vendas and Projetos screens — never a parallel one.
 */
import { projectClientPlan } from '../core/automation/projectClient'
import type { BatchOp } from './repository'
import { buyerNameOf, projectReceipts, receiptOps, receiptTxId, saleReceipts, type ReceiptCtx } from './receipts'
import type { DataState, Project, Sale, Settings } from './types'

/** Saves a project (new or existing); its payments' incomes follow, and its client when concluded/reopened. */
export function projectSaveOps(next: Project, data: DataState, settings: Settings, ctx: ReceiptCtx, now = new Date()): BatchOp[] {
  const before = data.projects.find((p) => p.id === next.id)
  return [
    { op: 'put', collection: 'projects', item: next },
    ...receiptOps(before ? projectReceipts(before) : [], projectReceipts(next), data.transactions, ctx),
    ...(projectClientPlan(before, next, data, settings, now)?.ops ?? []),
  ]
}

/** Saves sales (new or changed); incomes of their payments (specific and general) follow. */
export function saleSaveOps(changed: Sale[], data: Pick<DataState, 'sales' | 'clients' | 'transactions'>, ctx: ReceiptCtx): BatchOp[] {
  if (!changed.length) return []
  const ids = new Set(changed.map((s) => s.id))
  const current = data.sales
  const merged = [...current.filter((s) => !ids.has(s.id)), ...changed]
  // Only the incomes of payments in these sales (a general payment counts all its pieces).
  const touched = new Set<string>()
  for (const s of [...changed, ...current.filter((x) => ids.has(x.id))]) {
    for (const p of s.payments) if (p.finance) touched.add(p.generalId ? receiptTxId('general', p.generalId) : receiptTxId('sale', p.id))
  }
  const nameOf = buyerNameOf(data.clients)
  const before = saleReceipts(current, nameOf).filter((r) => touched.has(r.txId))
  const after = saleReceipts(merged, nameOf).filter((r) => touched.has(r.txId))
  return [...changed.map((s): BatchOp => ({ op: 'put', collection: 'sales', item: s })), ...receiptOps(before, after, data.transactions, ctx)]
}
