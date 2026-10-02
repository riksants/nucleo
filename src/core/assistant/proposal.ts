/**
 * Every change the Assistant or a reorganization wants to make is a proposal:
 * a list of changes, each with the records before and after. Nothing is
 * written until the person confirms; applying uses the app's normal save/remove
 * (same sync, same RLS); undo puts back the "before" of what was applied.
 */
import type { CollectionName, Entity } from '../../data/types'

export type Op =
  | { op: 'save'; collection: CollectionName; record: Entity & Record<string, unknown>; before: (Entity & Record<string, unknown>) | null }
  | { op: 'remove'; collection: CollectionName; id: string; before: Entity & Record<string, unknown> }

export interface Change {
  id: string
  /** "09:00 · Revisar contrato" */
  label: string
  /** "antes: sexta" */
  detail?: string
  ops: Op[]
}

export type ProposalKind = 'create' | 'update' | 'batch' | 'delete'

export interface Proposal {
  id: string
  kind: ProposalKind
  title: string
  summary: string
  changes: Change[]
  /** Neutral notes shown with the proposal ("o que não coube", "faixa usada"). */
  notes: string[]
}

export const isDestructive = (p: Proposal) => p.kind === 'delete' || p.changes.some((c) => c.ops.some((o) => o.op === 'remove'))

let n = 0
export const proposalId = () => `p${Date.now().toString(36)}${(++n).toString(36)}`

/** What can be undone: each record written and the version it replaced. */
export interface Applied {
  proposalId: string
  title: string
  at: string
  entries: { collection: CollectionName; id: string; before: (Entity & Record<string, unknown>) | null; writtenAt: string | null }[]
}

/** How a proposal reaches the data: the app's own save/remove (same sync, same rules). */
export interface ApplyIO {
  save(collection: CollectionName, record: Entity & Record<string, unknown>, opts: { by?: 'assistant'; keepMark?: boolean }): Promise<Entity>
  remove(collection: CollectionName, id: string): Promise<void>
  /** Current version of a record (for undo safety). */
  current(collection: CollectionName, id: string): Entity | undefined
}

/** Applies only the chosen changes, marking them "Alterado pelo Assistente". */
export async function applyProposal(p: Proposal, chosen: Set<string>, io: ApplyIO): Promise<Applied> {
  const applied: Applied = { proposalId: p.id, title: p.title, at: new Date().toISOString(), entries: [] }
  for (const change of p.changes) {
    if (!chosen.has(change.id)) continue
    for (const op of change.ops) {
      if (op.op === 'save') {
        const saved = await io.save(op.collection, op.record, { by: 'assistant' })
        applied.entries.push({ collection: op.collection, id: saved.id, before: op.before, writtenAt: saved.updatedAt })
      } else {
        await io.remove(op.collection, op.id)
        applied.entries.push({ collection: op.collection, id: op.id, before: op.before, writtenAt: null })
      }
    }
  }
  return applied
}

/** Puts back what was there before — never over a record changed again since then. */
export async function undoApplied(applied: Applied, io: ApplyIO): Promise<{ restored: number; skipped: number }> {
  let restored = 0
  let skipped = 0
  for (const e of [...applied.entries].reverse()) {
    const current = io.current(e.collection, e.id)
    if (e.writtenAt && current && current.updatedAt !== e.writtenAt) {
      skipped++
      continue
    }
    if (e.before) await io.save(e.collection, e.before, { keepMark: true })
    else if (current) await io.remove(e.collection, e.id)
    restored++
  }
  return { restored, skipped }
}
