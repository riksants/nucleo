import { useEffect } from 'react'
import { clearParams, useRoute } from '../app/router'
import type { Entity } from '../data/types'

/** Opens the item referenced by `?open=<id>` (used by global search and cross links). */
export function useOpenParam<T extends Entity>(items: T[], open: (item: T) => void) {
  const { params } = useRoute()
  const id = params.get('open')
  useEffect(() => {
    if (!id) return
    const item = items.find((x) => x.id === id)
    clearParams()
    if (item) open(item)
  }, [id])
}

/**
 * Runs `create` once when the screen opens with `?novo=<value>` (Buscar → "Nova tarefa", "Registrar saída"…),
 * the same as tapping the screen's own "+" button. `accept` says which values this screen handles.
 */
export function useNewParam(create: ((value: string) => void) | undefined, accept: (value: string) => boolean = (v) => v === '1') {
  const { params } = useRoute()
  const value = params.get('novo')
  useEffect(() => {
    if (!value || !create || !accept(value)) return
    clearParams()
    create(value)
    // Also when the screen's action becomes available after the first render.
  }, [value, !!create])
}
