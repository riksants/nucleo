import { useCallback, useMemo, useRef } from 'react'
import { useStore } from '../../data/store'
import type { CollectionName, DataState, Entity } from '../../data/types'
import { applyProposal, undoApplied, type Applied, type ApplyIO, type Proposal } from '../../core/assistant/proposal'

/** Last applied batches of this session (memory only), for "Desfazer". */
const history: Applied[] = []
export const lastApplied = () => history[history.length - 1] ?? null

/**
 * Applies the chosen changes of a proposal with the app's own save/remove
 * (same sync, same account rules), marking them "Alterado pelo Assistente".
 */
export function useApply() {
  const { data, save, remove } = useStore()
  const ref = useRef<DataState>(data)
  ref.current = data
  const io = useMemo<ApplyIO>(
    () => ({
      save: (c, r, o) => save(c, r as never, o) as Promise<Entity>,
      remove,
      current: (c, id) => (ref.current[c as CollectionName] as Entity[]).find((x) => x.id === id),
    }),
    [save, remove],
  )
  const apply = useCallback(
    async (p: Proposal, chosen: Set<string>) => {
      const applied = await applyProposal(p, chosen, io)
      history.push(applied)
      if (history.length > 5) history.shift()
      return applied
    },
    [io],
  )
  const undo = useCallback(
    async (applied: Applied) => {
      const r = await undoApplied(applied, io)
      const i = history.indexOf(applied)
      if (i >= 0) history.splice(i, 1)
      return r
    },
    [io],
  )
  return { apply, undo }
}
