import { useEffect, useState } from 'react'
import { useStore } from '../data/store'
import type { CollectionName } from '../data/types'
import { useFeedback } from './Feedback'

/** Form state that resets to `initial()` every time the sheet opens. */
export function useDraft<T>(open: boolean, initial: () => T) {
  const [draft, setDraft] = useState<T>(initial)
  useEffect(() => {
    if (open) setDraft(initial())
  }, [open])
  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value }))
  return [draft, set, setDraft] as const
}

/** Asks for confirmation, deletes, closes and confirms with a toast. */
export function useDelete() {
  const { remove } = useStore()
  const { confirm, toast } = useFeedback()
  return async (collection: CollectionName, id: string, what: string, opts: { feminine?: boolean; after?(): void } = {}) => {
    const ok = await confirm({
      title: `Excluir ${what}?`,
      message: 'Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return false
    await remove(collection, id)
    opts.after?.()
    toast(`${what[0].toUpperCase()}${what.slice(1)} ${opts.feminine ? 'excluída' : 'excluído'}`)
    return true
  }
}

/**
 * Open/close state for a sheet showing one item. The item is kept after closing
 * so the sheet doesn't change content during its exit animation.
 */
export function useSheet<T>() {
  const [state, setState] = useState<{ open: boolean; item: T | null }>({ open: false, item: null })
  return {
    open: state.open,
    item: state.item,
    show: (item: T | null = null) => setState({ open: true, item }),
    close: () => setState((s) => ({ ...s, open: false })),
  }
}
