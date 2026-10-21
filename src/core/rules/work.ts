/**
 * A working copy of the data while rules are planned: each action sees what the previous ones did
 * (two reservations share the same Disponível), and everything ends as one list of writes.
 */
import type { BatchOp } from '../../data/repository'
import type { CollectionName, Collections, DataState, Entity } from '../../data/types'

/**
 * The data as it is after `ops` (only the touched collections are copied). Same result as applying
 * the ops one by one — a record already in the list is replaced in place, a new one goes on top (the
 * newest first), a removed one leaves — in one pass per collection, so a write of thousands of
 * records (a bank statement) stays fast.
 */
export function applyOps(data: DataState, ops: BatchOp[]): DataState {
  const next = { ...data } as Record<CollectionName, Entity[]>
  const byCollection = new Map<CollectionName, BatchOp[]>()
  for (const o of ops) {
    const list = byCollection.get(o.collection)
    if (list) list.push(o)
    else byCollection.set(o.collection, [o])
  }
  for (const [collection, list] of byCollection) {
    const original = next[collection]
    const current = new Map<string, Entity>()
    for (const x of original) current.set(x.id, x)
    const added: string[] = []
    const isNew = new Set<string>()
    for (const o of list) {
      if (o.op === 'remove') {
        current.delete(o.id)
        isNew.delete(o.id)
      } else if (current.has(o.item.id)) current.set(o.item.id, o.item)
      else {
        current.set(o.item.id, o.item)
        isNew.add(o.item.id)
        added.push(o.item.id)
      }
    }
    const head: Entity[] = []
    const seen = new Set<string>()
    for (let i = added.length - 1; i >= 0; i--) {
      const id = added[i]
      if (!isNew.has(id) || seen.has(id)) continue
      seen.add(id)
      head.push(current.get(id)!)
    }
    const tail: Entity[] = []
    for (const x of original) if (current.has(x.id) && !isNew.has(x.id)) tail.push(current.get(x.id)!)
    next[collection] = head.length ? [...head, ...tail] : tail
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
