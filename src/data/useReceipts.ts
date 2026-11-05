import { useCallback, useEffect, useMemo } from 'react'
import type { BatchOp } from './repository'
import { allReceipts, belongsToProject, belongsToSale, missingReceipts, receiptTransaction, unlinkOps } from './receipts'
import { projectSaveOps, saleSaveOps } from './saveOps'
import { useStore } from './store'
import type { Project, ReceiptSource, Sale } from './types'

/**
 * The one way Projetos and Vendas save payments: the record and its incomes in Financeiro go
 * together (see data/receipts.ts for the rules).
 */
export function useReceipts() {
  const { data, settings, convert, commit } = useStore()

  /**
   * Saves a project (new or existing); its payments' incomes follow (new, changed, removed, renamed),
   * and so does its client when the project is concluded or reopened (automation, same transaction).
   */
  const saveProject = useCallback(
    async (next: Project) => {
      await commit(projectSaveOps(next, data, settings, { settings, convert }))
      return next
    },
    [data, settings, convert, commit],
  )

  /** Saves sales (new or changed); incomes of their payments (specific and general) follow. */
  const saveSales = useCallback(
    async (changed: Sale[]) => {
      if (!changed.length) return
      await commit(saleSaveOps(changed, data, { settings, convert }))
    },
    [data, settings, convert, commit],
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
      if (ops.length) void commit(ops, { by: 'automation' })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [missing, idle, settings, convert, commit])
}
