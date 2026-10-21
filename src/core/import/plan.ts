/**
 * Turns the confirmed preview into ONE write: every new movement, every reconciliation and the
 * import's record ("Feito pelo Núcleo" / Importações) go to the device together, or nothing does.
 *
 * Checked again at this moment against the data as it is now (another device may have synced the
 * same lines meanwhile): a line whose id already exists is never written twice; a movement already
 * reconciled is never linked twice. Nothing about money is invented: the value and currency are the
 * ones in the file; the base value uses the rates of now, exactly like a movement typed by hand.
 */
import type { BatchOp } from '../../data/repository'
import type { AutomationRun, BankImportInfo, BankRef, DataState, Rule, Transaction } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { makeRun, runPut } from '../automation/types'
import { fingerprint } from '../rules/actions'
import { MAX_RUNS_PER_WRITE } from '../rules/engine'
import { hash16 } from '../rules/hash'
import type { RuleCtx, RuleEvent } from '../rules/types'
import { defaultAction, type Analysis, type AnalyzedLine, type LineAction } from './analyze'
import { categoryOnly } from './categorize'

export interface Decision {
  action: LineAction
  /** The category chosen (null = none). Undefined = what the preview suggested. */
  category?: string | null
}

export interface ImportMeta {
  importId: string
  file: string
  format: 'csv' | 'ofx'
  account: string
  template?: string
}

export interface ImportPlan {
  ops: BatchOp[]
  run: AutomationRun
  /** Ids of the movements created (their rules run in the same write). */
  created: Set<string>
  /** How the rules treat this write. */
  rules: { maxRuns: number; skip(rule: Rule, ev: RuleEvent): boolean }
}

/** How the movement was written, without its own mark (an edit later changes it). */
export const bankFp = (t: Transaction): string => {
  const { bank, ...rest } = t
  const { fp: _fp, ...ref } = bank ?? ({} as BankRef)
  void _fp
  return hash16(fingerprint({ ...rest, bank: ref }))
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What happens to a line: the person's choice, else the default (anything uncertain is left out). */
export function actionOf(l: AnalyzedLine, d: Decision | undefined): LineAction {
  return l.locked ? 'skip' : (d?.action ?? defaultAction(l))
}

export function categoryOf(l: AnalyzedLine, d: Decision | undefined): string | null {
  if (d && d.category !== undefined) return d.category
  return l.category?.id ?? null
}

/** The plan, or a message saying why nothing can be written. */
export function planImport(analysis: Analysis, decisions: Map<number, Decision>, meta: ImportMeta, data: DataState, ctx: RuleCtx): ImportPlan | string {
  const now = ctx.now.toISOString()
  const byId = new Map(data.transactions.map((t) => [t.id, t]))
  const lineTaken = new Set(data.transactions.flatMap((t) => (t.bank?.line ? [t.bank.line] : [])))
  const ops: BatchOp[] = []
  const created = new Set<string>()
  const linked = new Set<string>()
  const info: BankImportInfo = { file: meta.file, format: meta.format, ...(meta.template ? { template: meta.template } : {}), ...(meta.account ? { account: meta.account } : {}), lines: analysis.lines.length, created: 0, duplicates: 0, possible: 0, reconciled: 0, autoReconciled: 0, categorized: 0, autoCategorized: 0, review: 0, errors: 0, ...(analysis.from ? { from: analysis.from, to: analysis.to } : {}) }
  const missingRate = new Set<string>()

  for (const l of analysis.lines) {
    const d = decisions.get(l.i)
    const action = actionOf(l, d)
    if (action === 'skip') {
      if (l.line.error || !l.currency) info.errors++
      else if (l.status === 'duplicate') info.duplicates++
      else if (l.status === 'possible') info.possible++
      else if (l.status !== 'new' && l.status !== 'reconciled') info.review++
      continue
    }
    const ref: BankRef = {
      importId: meta.importId,
      day: l.day,
      date: l.line.date,
      raw: l.line.description,
      ...(l.line.memo ? { memo: l.line.memo } : {}),
      ...(l.line.fitid ? { fitid: l.line.fitid } : {}),
      ...(meta.account ? { account: meta.account } : {}),
      ...(meta.template ? { template: meta.template } : {}),
    }
    if (action === 'reconcile') {
      const tx = l.match ? byId.get(l.match.txId) : undefined
      // Gone, or already confirmed by another line/import: nothing is linked twice.
      if (!tx || tx.bank || linked.has(tx.id) || lineTaken.has(l.id) || byId.has(l.id)) {
        info.duplicates++
        continue
      }
      linked.add(tx.id)
      const confirmed: Transaction = { ...tx, bank: { ...ref, reconciled: true, line: l.id } }
      ops.push({ op: 'put', collection: 'transactions', item: confirmed })
      info.reconciled++
      if (l.status === 'reconciled' && d?.action === undefined) info.autoReconciled++
      continue
    }
    // import
    if (byId.has(l.id) || lineTaken.has(l.id) || created.has(l.id)) {
      info.duplicates++
      continue
    }
    const base = l.currency === ctx.settings.baseCurrency ? l.amount : ctx.convert(l.amount, l.currency, ctx.settings.baseCurrency)
    if (base === null) {
      missingRate.add(l.currency)
      continue
    }
    const category = categoryOf(l, d)
    // Left as the Núcleo suggested (not chosen by the person): not counted as learning later.
    const auto = Boolean(category && l.category && d?.category === undefined && category === l.category.id)
    const tx: Transaction = {
      id: l.id,
      createdAt: `${l.day}T12:00:00.000Z`,
      updatedAt: now,
      type: l.type,
      amount: l.amount,
      currency: l.currency,
      baseAmount: l.type === 'in' ? base : -base,
      reason: l.reason,
      ...(category ? { category } : {}),
      bank: { ...ref, ...(auto ? { autoCategory: category! } : {}) },
    }
    tx.bank!.fp = bankFp(tx)
    ops.push({ op: 'put', collection: 'transactions', item: tx })
    created.add(tx.id)
    info.created++
    if (category) info.categorized++
    if (auto) info.autoCategorized++
  }

  if (missingRate.size) {
    const list = [...missingRate].join(', ')
    return `Sem cotação para converter ${list} na sua moeda principal. Atualize as cotações (ou informe uma manual em Configurações) e tente de novo — nada foi importado.`
  }

  const parts: string[] = []
  if (info.autoCategorized) parts.push(plural(info.autoCategorized, 'categoria aplicada automaticamente', 'categorias aplicadas automaticamente'))
  if (info.reconciled) parts.push(plural(info.reconciled, 'movimentação conciliada', 'movimentações conciliadas'))
  if (info.duplicates) parts.push(plural(info.duplicates, 'duplicada ignorada', 'duplicadas ignoradas'))
  const left = info.possible + info.review + info.errors
  if (left) parts.push(`${plural(left, 'linha ficou', 'linhas ficaram')} de fora`)
  const file = `“${meta.file}”`
  const summary = info.created
    ? `Núcleo importou ${plural(info.created, 'movimentação', 'movimentações')} de ${file}`
    : info.reconciled
      ? `Núcleo conciliou ${plural(info.reconciled, 'movimentação', 'movimentações')} de ${file}`
      : `Nada novo em ${file}`
  const run = makeRun(
    {
      id: meta.importId,
      automation: 'bankImport',
      date: ctx.today,
      summary,
      ...(parts.length ? { detail: parts.join(' · ') } : {}),
      origin: { collection: 'transactions', id: '', label: 'Importações' },
      created: [],
      changed: [],
      status: info.created || info.reconciled ? 'done' : 'skipped',
      bankImport: info,
    },
    ctx.now,
  )
  ops.push(runPut(run))
  return {
    ops,
    run,
    created,
    // One run per new movement and rule is expected here; the daily limit of each rule still holds.
    rules: { maxRuns: Math.max(MAX_RUNS_PER_WRITE, created.size * 3), skip: (rule, ev) => Boolean(ev.txId && created.has(ev.txId) && categoryOnly(rule)) },
  }
}

/** Short money text for a line ("−€12,50"). */
export const lineMoney = (l: Pick<AnalyzedLine, 'type' | 'amount' | 'currency'>) => `${l.type === 'out' ? '−' : '+'}${formatMoney(l.amount, l.currency)}`
