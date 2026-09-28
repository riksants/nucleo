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
