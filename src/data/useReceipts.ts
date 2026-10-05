import { useCallback, useEffect, useMemo } from 'react'
import type { BatchOp } from './repository'
import {
  allReceipts,
  belongsToProject,
  belongsToSale,
  buyerNameOf,
  missingReceipts,
  projectReceipts,
  receiptOps,
  receiptTransaction,
  receiptTxId,
  saleReceipts,
  unlinkOps,
} from './receipts'
import { useStore } from './store'
import type { Project, ReceiptSource, Sale } from './types'

/**
 * The one way Projetos and Vendas save payments: the record and its incomes in Financeiro go
 * together (see data/receipts.ts for the rules).
 */
export function useReceipts() {
  const { data, settings, convert, commit } = useStore()

  /** Saves an existing project; its payments' incomes follow (new, changed, removed, renamed). */
  const saveProject = useCallback(
    async (next: Project) => {
      const before = data.projects.find((p) => p.id === next.id)
      const ops: BatchOp[] = [
        { op: 'put', collection: 'projects', item: next },
        ...receiptOps(before ? projectReceipts(before) : [], projectReceipts(next), data.transactions, { settings, convert }),
      ]
      await commit(ops)
      return next
    },
    [data.projects, data.transactions, settings, convert, commit],
  )

  /** Saves sales (new or changed); incomes of their payments (specific and general) follow. */
  const saveSales = useCallback(
    async (changed: Sale[]) => {
      if (!changed.length) return
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
      await commit([...changed.map((s): BatchOp => ({ op: 'put', collection: 'sales', item: s })), ...receiptOps(before, after, data.transactions, { settings, convert })])
    },
    [data.sales, data.clients, data.transactions, settings, convert, commit],
  )

  /** Incomes in Financeiro linked to a project/sale (shown before deleting it). */
  const linkedCount = useCallback((belongs: (s: ReceiptSource) => boolean) => data.transactions.filter((t) => t.source && belongs(t.source)).length, [data.transactions])

  /** Deletes a project; its incomes stay in Financeiro without the link (the money was received). */
  const removeProject = useCallback(
    (p: Project) => commit([{ op: 'remove', collection: 'projects', id: p.id }, ...unlinkOps(data.transactions, belongsToProject(p.id))]),
    [data.transactions, commit],
  )

  /** Deletes a sale; incomes of its payments (and of general payments with a piece in it) stay, unlinked. */
  const removeSale = useCallback((s: Sale) => commit([{ op: 'remove', collection: 'sales', id: s.id }, ...unlinkOps(data.transactions, belongsToSale(s))]), [data.transactions, commit])

  /** A payment whose income doesn't exist yet: waiting for a rate of its currency. */
  const txIds = useMemo(() => new Set(data.transactions.map((t) => t.id)), [data.transactions])
  const isPending = useCallback((txId: string) => !txIds.has(txId), [txIds])

  return { saveProject, saveSales, removeProject, removeSale, linkedCount, isPending }
}

/**
 * Creates the incomes that are still missing — a payment saved without a rate (created once the
 * rate exists) or a write interrupted halfway. Fixed ids: running twice, or on two devices, writes
 * the same record. Signed in, it only runs with the sync idle and nothing queued, so a device that
 * hasn't received the latest changes yet doesn't act on old data.
 */
export function useReceiptReconciler() {
  const { ready, data, settings, convert, commit, syncStatus } = useStore()
  const idle = !syncStatus || (syncStatus.state === 'idle' && syncStatus.pending === 0)
  const missing = useMemo(() => (ready && settings.onboarded ? missingReceipts(allReceipts(data), data.transactions) : []), [ready, settings.onboarded, data])
  useEffect(() => {
    if (!missing.length || !idle) return
    const timer = window.setTimeout(() => {
      const ops: BatchOp[] = []
      for (const r of missing) {
        const tx = receiptTransaction(r, { settings, convert })
        if (tx) ops.push({ op: 'put', collection: 'transactions', item: tx })
      }
      if (ops.length) void commit(ops)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [missing, idle, settings, convert, commit])
}
