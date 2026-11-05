/**
 * NÚCLEO IA — confirming and undoing a plan.
 *
 * - Only after the person taps Confirmar; the login must still be the account the plan was built for.
 * - ONE commit (the repository's atomic batch): everything is written, or nothing is. The person's rules
 *   react as to any Assistant write, IN THE SAME WRITE; the commit returns everything it wrote, so the
 *   confirmation knows what the rules did (reserves, tasks, notes, status, category…) and shows it.
 * - A second confirm of the same plan writes nothing new (fixed ids / absolute values / pins).
 *
 * "Desfazer tudo" never leaves a half state and never lets the person believe something was undone
 * when it was not:
 * - the plan's records go back to how they were before the confirm;
 * - the rule runs of that same confirm are undone by the app's own path (core/automation/undo undoRun:
 *   the same as "Feito pelo Núcleo"), so a reserve a rule made goes back too;
 * - an income created LATER for one of the plan's payments (a rate that arrived afterwards) goes too;
 * - anything else that happened AFTER and depends on these records (a later rule run, a task the person
 *   added to the new project, an edit) stops the whole undo, with the exact list of what remains.
 */
import { undoRun } from '../../../automation/undo'
import { todayIn, zoneOf } from '../../../period'
import type { BatchOp } from '../../../../data/repository'
import type { CommitOptions } from '../../../../data/store'
import type { AutomationRun, CollectionName, DataState, Entity, Settings, Transaction } from '../../../../data/types'
import type { Converter } from '../../../../lib/rates'
import type { Area } from '../../../../../supabase/functions/_shared/ia/tools.ts'
import { compilePlan, type Plan } from './plan'

export interface ApplyIO {
  /** The store's commit: returns everything written (the ops + what the person's rules added). */
  commit(ops: BatchOp[], opts: CommitOptions): Promise<BatchOp[] | void>
  snapshot(): { data: DataState; settings: Settings }
  convert: Converter
  currentUid(): Promise<string | null>
  areasOff: Area[]
}

type Key = `${string}|${string}`
const keyOf = (collection: CollectionName, id: string): Key => `${collection}|${id}`

export interface AppliedPlan {
  planId: string
  at: string
  /** The plan's own records: what was written (final version, after the rules) and what was there before. */
  entries: { collection: CollectionName; id: string; written: Record<string, unknown>; before: (Entity & Record<string, unknown>) | null }[]
  /** Rule runs of this same write ("Feito pelo Núcleo"): ids + what each did. */
  ruleRuns: { id: string; text: string }[]
}

export type ApplyResult = { ok: true; applied: AppliedPlan | null; written: number; alreadyApplied: string[]; ruleEffects: string[] } | { ok: false; problems: string[] }

const runText = (r: AutomationRun) => `${r.rule?.name ? `Regra “${r.rule.name}”: ` : ''}${r.summary}`

export async function applyPlan(plan: Plan, chosen: Set<string>, io: ApplyIO, now = new Date()): Promise<ApplyResult> {
  if ((await io.currentUid()) !== plan.uid) return { ok: false, problems: ['A conta conectada mudou: este plano não pode ser aplicado.'] }
  if (!chosen.size) return { ok: false, problems: ['Nenhum item marcado.'] }
  const { data, settings } = io.snapshot()
  const c = compilePlan(plan, chosen, { data, settings, now, areasOff: io.areasOff, convert: io.convert })
  if (c.problems.length) return { ok: false, problems: c.problems }
  if (!c.ops.length) return { ok: true, applied: null, written: 0, alreadyApplied: c.alreadyApplied, ruleEffects: [] }
  let all: BatchOp[]
  try {
    all = (await io.commit(c.ops, { by: 'assistant', mark: 'assistant' })) || c.ops
  } catch (e) {
    return { ok: false, problems: [`Nada foi gravado: ${e instanceof Error ? e.message : 'falha ao salvar no aparelho'}. Tente de novo.`] }
  }
  // final version of each record in this write (a rule may have changed one of the plan's records)
  const last = new Map<Key, BatchOp>()
  for (const o of all) last.set(keyOf(o.collection, o.op === 'put' ? (o.item as Entity).id : o.id), o)
  const ruleRuns: AppliedPlan['ruleRuns'] = []
  for (const o of all) if (o.op === 'put' && o.collection === 'automationRuns' && (o.item as unknown as AutomationRun).automation === 'rule') ruleRuns.push({ id: (o.item as Entity).id, text: runText(o.item as unknown as AutomationRun) })
  const entries: AppliedPlan['entries'] = []
  const seen = new Set<Key>()
  for (const o of c.ops) {
    const id = o.op === 'put' ? (o.item as Entity).id : o.id
    const k = keyOf(o.collection, id)
    if (seen.has(k)) continue
    seen.add(k)
    const fin = last.get(k)!
    const prev = c.before.find((b) => b.collection === o.collection && b.id === id)
    entries.push({ collection: o.collection, id, written: fin.op === 'put' ? (fin.item as unknown as Record<string, unknown>) : { __removed: true }, before: prev?.item ?? null })
  }
  return { ok: true, applied: { planId: plan.id, at: now.toISOString(), entries, ruleRuns }, written: c.ops.length, alreadyApplied: c.alreadyApplied, ruleEffects: ruleRuns.map((r) => r.text) }
}

const STAMPS = new Set(['updatedAt', 'changedBy'])
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter((k) => !STAMPS.has(k) && (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => !STAMPS.has(k) && (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

export type UndoResult = { ok: true; restored: number; ruleEffects: string[] } | { ok: false; problem: string; remaining: string[] }

/** Fields through which another record points to one of the plan's records. */
const REF_FIELDS = ['projectId', 'clientId', 'planId', 'taskId', 'offeringId', 'goalId'] as const

export async function undoPlan(applied: AppliedPlan, io: Pick<ApplyIO, 'commit' | 'snapshot'>, now = new Date()): Promise<UndoResult> {
  const { data, settings } = io.snapshot()
  const today = todayIn(zoneOf(settings), now)
  const refuse = (problem: string, remaining: string[]): UndoResult => ({ ok: false, problem, remaining })
  const ours = new Set(applied.entries.map((e) => keyOf(e.collection, e.id)))
  const ourIds = new Set(applied.entries.map((e) => e.id))
  const ruleRunIds = new Set(applied.ruleRuns.map((r) => r.id))

  // 1) the plan's records must be exactly as written
  const ops: BatchOp[] = []
  for (const e of [...applied.entries].reverse()) {
    const current = (data[e.collection] as unknown as Entity[]).find((x) => x.id === e.id)
    const removed = (e.written as { __removed?: boolean }).__removed
    const unchanged = removed ? !current : Boolean(current) && same(current, e.written)
    if (!unchanged) return refuse('Algo foi alterado depois de confirmar: para não deixar registros pela metade, nada foi desfeito.', [`${labelOf(e.collection)} alterado depois da confirmação`])
    if (e.before) ops.push({ op: 'put', collection: e.collection, item: e.before as never })
    else ops.push({ op: 'remove', collection: e.collection, id: e.id })
  }

  // 2) the rule runs of the same write: undone by the app's own path (reserves go back, run marked "desfeita")
  const ruleEffects: string[] = []
  for (const id of ruleRunIds) {
    const run = data.automationRuns.find((r) => r.id === id)
    if (!run || run.status === 'undone') continue
    // the app gives back exactly the reserved amount; if the goal now holds less, part of it can't come back
    for (const ch of run.changed) {
      if (ch.collection !== 'financeGoals' || ch.field !== 'saved' || ch.delta === undefined) continue
      const g = data.financeGoals.find((x) => x.id === ch.id)
      if (g && g.saved < ch.delta) return refuse('Uma reserva feita por regra nessa confirmação não pode voltar inteira: a meta tem menos dinheiro guardado agora. Nada foi desfeito.', [`${runText(run)} — a meta “${g.name}” tem menos que o valor reservado`])
    }
    const u = undoRun(run, data, today)
    if (u.partial) return refuse('Uma regra que agiu nessa confirmação teve registros alterados depois: nada foi desfeito.', [runText(run)])
    // records of the plan itself go back to their pre-confirm version above (which is before the rule too)
    for (const o of u.ops) if (!ours.has(keyOf(o.collection, o.op === 'put' ? (o.item as Entity).id : o.id)) || o.collection === 'automationRuns') ops.push(o)
    ruleEffects.push(runText(run))
  }

  // 3) what happened AFTER, linked to these records (what the same-write rule runs created is handled above)
  const byRules = new Set<Key>()
  for (const id of ruleRunIds) {
    const run = data.automationRuns.find((r) => r.id === id)
    for (const c of run?.created ?? []) byRules.add(keyOf(c.collection, c.id))
  }
  const planPayments = new Set<string>()
  for (const e of applied.entries) for (const p of ((e.written as { payments?: { id: string }[] }).payments ?? [])) planPayments.add(p.id)
  const remaining: string[] = []
  for (const t of data.transactions as Transaction[]) {
    if (ours.has(keyOf('transactions', t.id)) || byRules.has(keyOf('transactions', t.id))) continue
    if (t.source && (planPayments.has(t.source.paymentId) || ourIds.has(t.source.parentId))) {
      // an income created later for a payment of this plan: it goes with the payment
      if (planPayments.has(t.source.paymentId)) ops.push({ op: 'remove', collection: 'transactions', id: t.id })
      else remaining.push(`Entrada “${t.reason}” ligada a um registro do plano`)
    }
  }
  for (const r of data.automationRuns) {
    if (ruleRunIds.has(r.id) || r.status !== 'done' || r.automation !== 'rule') continue
    const touches = ourIds.has(r.origin.id) || (r.cause?.txId && ourIds.has(r.cause.txId)) || r.changed.some((c) => ourIds.has(c.id))
    if (touches) remaining.push(`${runText(r)} (feito depois — desfaça em “Feito pelo Núcleo”)`)
  }
  for (const [collection, list] of Object.entries(data) as [CollectionName, Entity[]][]) {
    if (collection === 'automationRuns' || collection === 'transactions') continue
    for (const x of list) {
      if (ours.has(keyOf(collection, x.id)) || byRules.has(keyOf(collection, x.id))) continue
      const ref = REF_FIELDS.find((f) => {
        const v = (x as unknown as Record<string, unknown>)[f]
        return typeof v === 'string' && ourIds.has(v)
      })
      if (ref) remaining.push(`${labelOf(collection)} “${(x as unknown as { title?: string; name?: string }).title ?? (x as unknown as { name?: string }).name ?? x.id}”, criado depois e ligado a um registro do plano`)
    }
  }
  if (remaining.length) return refuse('Depois da confirmação, outras coisas passaram a depender desses registros. Para não deixar dinheiro ou registros soltos, nada foi desfeito. Resolva estes itens primeiro:', remaining)

  try {
    await io.commit(ops, { by: 'undo' })
  } catch {
    return refuse('Não foi possível desfazer agora. Nada foi alterado.', [])
  }
  return { ok: true, restored: ops.length, ruleEffects }
}

const LABEL: Partial<Record<CollectionName, string>> = { tasks: 'Tarefa', projects: 'Projeto', clients: 'Cliente', sales: 'Venda', transactions: 'Lançamento', financeGoals: 'Meta', events: 'Compromisso', notes: 'Anotação', habits: 'Hábito', shoppingItems: 'Item de compra', planSteps: 'Etapa', inbox: 'Item da caixa de entrada' }
const labelOf = (c: CollectionName) => LABEL[c] ?? 'Registro'
