/**
 * A working copy of the data while rules are planned: each action sees what the previous ones did
 * (two reservations share the same Disponível), and everything ends as one list of writes.
 */
import type { BatchOp } from '../../data/repository'
import type { CollectionName, Collections, DataState, Entity } from '../../data/types'

/** The data as it is after `ops` (only the touched collections are copied). */
export function applyOps(data: DataState, ops: BatchOp[]): DataState {
  const next = { ...data } as Record<CollectionName, Entity[]>
  for (const o of ops) {
    const list = next[o.collection]
    if (o.op === 'remove') next[o.collection] = list.filter((x) => x.id !== o.id)
    else next[o.collection] = list.some((x) => x.id === o.item.id) ? list.map((x) => (x.id === o.item.id ? o.item : x)) : [o.item, ...list]
  }
  return next as unknown as DataState
}

export class Work {
  private data: DataState
  private writes = new Map<string, BatchOp>()

  constructor(data: DataState) {
    this.data = data
  }

  list<K extends CollectionName>(collection: K): Collections[K][] {
    return this.data[collection] as Collections[K][]
  }

  get<K extends CollectionName>(collection: K, id: string | null | undefined): Collections[K] | undefined {
    if (!id) return undefined
    return this.list(collection).find((x) => x.id === id)
  }

  put<K extends CollectionName>(collection: K, item: Collections[K]): void {
    this.data = applyOps(this.data, [{ op: 'put', collection, item }])
    const key = `${collection}:${item.id}`
    this.writes.delete(key)
    this.writes.set(key, { op: 'put', collection, item })
  }

  /** Several writes planned elsewhere (e.g. the projeto → cliente automation). */
  apply(ops: BatchOp[]): void {
    for (const o of ops) if (o.op === 'put') this.put(o.collection, o.item as never)
  }

  snapshot(): DataState {
    return this.data
  }

  ops(): BatchOp[] {
    return [...this.writes.values()]
  }
}
