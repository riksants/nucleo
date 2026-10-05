/**
 * Received money ↔ Financeiro, shared by Projetos and Vendas.
 *
 * A payment that was really received becomes ONE income in Financeiro:
 * - its id is fixed and derived from the payment ("rcv-project-<payment id>"), so saving it again,
 *   a second device, a repeated sync or a retry always lands on the same record — never a second one;
 * - the payment and its income are written in one device transaction (Repository.batch);
 * - editing the payment updates that same income; removing the payment removes it;
 * - without a rate for the currency the payment is still saved and the income is created as soon
 *   as there is one (same fixed id, so it can't duplicate);
 * - deleting the project/sale keeps the incomes (the money was received), only without the link;
 * - payments recorded before this integration (Vendas) and the old "Recebido" of projects never
 *   create incomes by themselves.
 *
 * The balance stays what it always was: initial balance + every movement (selectors.balanceOf).
 */
import { dayOf } from '../core/indexes'
import { todayIn, zoneOf } from '../core/period'
import { fromDateInput } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { Converter } from '../lib/rates'
import { zonedToInstant } from '../lib/zoned'
import type { BatchOp } from './repository'
import type { Cents, Client, Currency, DataState, Project, ProjectPayment, ReceiptSource, Sale, Settings, Transaction } from './types'

export interface Receipt {
  /** The fixed id of its income in Financeiro. */
  txId: string
  source: ReceiptSource
  amount: Cents
  currency: Currency
  /** "YYYY-MM-DD": the income is placed on this day. */
  date: string
  reason: string
  category: 'freelance' | 'sales'
  /** Where the payment lives (to open it from Financeiro). */
  open: { path: '/projects' | '/sales'; id: string }
}

export const receiptTxId = (kind: 'project' | 'sale' | 'general', paymentId: string) => `rcv-${kind}-${paymentId}`

// ---------- Projects

/** Old "Recebido" (before the history) + every payment. */
export function projectReceived(p: Pick<Project, 'received' | 'payments'>): Cents {
  return (p.received ?? 0) + (p.payments ?? []).reduce((sum, x) => sum + x.amount, 0)
}

/** What is still missing; never negative. A project without a value has nothing "missing". */
export function projectRemaining(p: Pick<Project, 'charged' | 'received' | 'payments'>, exceptPaymentId?: string): Cents {
  const others = { ...p, payments: (p.payments ?? []).filter((x) => x.id !== exceptPaymentId) }
  return Math.max(p.charged - projectReceived(others), 0)
}

export const OVER_REMAINING = 'O valor informado é maior que o valor restante.'

/** Error message, or null when the payment can be saved (editing: its old value doesn't count). */
export function projectPaymentProblem(p: Pick<Project, 'charged' | 'received' | 'payments'>, pay: Pick<ProjectPayment, 'id' | 'amount' | 'date'>): string | null {
  if (!pay.amount || pay.amount <= 0) return 'Digite o valor recebido'
  if (!fromDateInput(pay.date)) return 'Informe a data do pagamento'
  if (p.charged > 0 && pay.amount > projectRemaining(p, pay.id)) return OVER_REMAINING
  return null
}

/** The project's value can't go below what was already received. */
export function projectChargedProblem(p: Pick<Project, 'received' | 'payments'>, charged: Cents, currency: Currency): string | null {
  const got = projectReceived(p)
  if (charged > 0 && charged < got) return `O valor do projeto não pode ser menor que o já recebido (${formatMoney(got, currency)}).`
  return null
}

export function projectReceipts(p: Project): Receipt[] {
  return (p.payments ?? []).map((pay) => ({
    txId: receiptTxId('project', pay.id),
    source: { kind: 'project', parentId: p.id, paymentId: pay.id },
    amount: pay.amount,
    currency: pay.currency,
    date: pay.date,
    reason: `${p.name} · Pagamento de projeto`,
    category: 'freelance',
    open: { path: '/projects', id: p.id },
  }))
}

// ---------- Sales

export function buyerNameOf(clients: Pick<Client, 'id' | 'name'>[]) {
  const byId = new Map(clients.map((c) => [c.id, c.name]))
  return (s: Pick<Sale, 'clientId' | 'clientName'>) => (s.clientId ? (byId.get(s.clientId) ?? '') : s.clientName).trim()
}

/**
 * Payments of sales recorded since the integration: a specific payment is one income; a general
 * payment ("pagamento geral", split by the app over several purchases) is ONE income with its whole value.
 */
export function saleReceipts(sales: Sale[], nameOf: (s: Sale) => string): Receipt[] {
  const out: Receipt[] = []
  const general = new Map<string, Receipt>()
  for (const s of sales) {
    const who = nameOf(s) || 'cliente'
    for (const p of s.payments) {
      if (!p.finance) continue
      if (!p.generalId) {
        out.push({
          txId: receiptTxId('sale', p.id),
          source: { kind: 'sale', parentId: s.id, paymentId: p.id },
          amount: p.amount,
          currency: s.currency,
          date: p.date,
          reason: `Pagamento de venda — ${who} · ${s.product}`,
          category: 'sales',
          open: { path: '/sales', id: s.id },
        })
        continue
      }
      const g = general.get(p.generalId)
      if (g) {
        g.amount += p.amount
        // Stable on every device whatever the order of the list: the smallest sale id.
        if (s.id < g.source.parentId) g.source.parentId = g.open.id = s.id
      } else {
        const r: Receipt = {
          txId: receiptTxId('general', p.generalId),
          source: { kind: 'saleGeneral', parentId: s.id, paymentId: p.generalId },
          amount: p.amount,
          currency: s.currency,
          date: p.date,
          reason: `Pagamento de venda — ${who}`,
          category: 'sales',
          open: { path: '/sales', id: s.id },
        }
        general.set(p.generalId, r)
        out.push(r)
      }
    }
  }
  return out
}

/** Every receipt of the account (projects + sales). */
export function allReceipts(data: Pick<DataState, 'projects' | 'sales' | 'clients'>): Receipt[] {
  return [...data.projects.flatMap(projectReceipts), ...saleReceipts(data.sales, buyerNameOf(data.clients))]
}

// ---------- The income

export interface ReceiptCtx {
  settings: Pick<Settings, 'baseCurrency' | 'timeZone'>
  convert: Converter
  now?: Date
}

/** The moment the income is placed at: the payment's day (today = now; another day = noon of that day). */
function instantFor(date: string, tz: string, now: Date, existing?: string): string {
  if (existing && dayOf(existing, tz) === date) return existing
  if (date === todayIn(tz, now)) return now.toISOString()
  return zonedToInstant(date, '12:00', tz).toISOString()
}

/**
 * The income of a receipt, or null while there is no rate for its currency (it is created later).
 * Editing keeps the rate of the original moment, like editing a movement in Financeiro does.
 */
export function receiptTransaction(r: Receipt, ctx: ReceiptCtx, existing?: Transaction): Transaction | null {
  const now = ctx.now ?? new Date()
  const keepRate = existing && existing.currency === r.currency && existing.amount > 0 && existing.baseAmount !== 0
  const base = keepRate ? Math.round((Math.abs(existing.baseAmount) / existing.amount) * r.amount) : ctx.convert(r.amount, r.currency, ctx.settings.baseCurrency)
  if (base === null) return null
  const at = now.toISOString()
  return {
    id: r.txId,
    createdAt: instantFor(r.date, zoneOf(ctx.settings), now, existing?.createdAt),
    updatedAt: at,
    type: 'in',
    amount: r.amount,
    currency: r.currency,
    baseAmount: base,
    reason: r.reason,
    category: r.category,
    source: { ...r.source },
  }
}

/** Does the income already say exactly what the receipt says? */
export function matchesReceipt(tx: Transaction, r: Receipt, tz: string): boolean {
  return (
    tx.amount === r.amount &&
    tx.currency === r.currency &&
    tx.reason === r.reason &&
    tx.category === r.category &&
    dayOf(tx.createdAt, tz) === r.date &&
    tx.source?.kind === r.source.kind &&
    tx.source.parentId === r.source.parentId &&
    tx.source.paymentId === r.source.paymentId
  )
}

/**
 * The Financeiro writes that follow a change of payments: `before` → `after` (receipts of the same
 * records). New or changed → put its income (same fixed id); gone → remove it. An income the person
 * unlinked (no `source`) is never touched again.
 */
export function receiptOps(before: Receipt[], after: Receipt[], transactions: Transaction[], ctx: ReceiptCtx): BatchOp[] {
  const txs = new Map(transactions.map((t) => [t.id, t]))
  const tz = zoneOf(ctx.settings)
  const ops: BatchOp[] = []
  const keep = new Set(after.map((r) => r.txId))
  for (const r of after) {
    const tx = txs.get(r.txId)
    if (tx && !tx.source) continue
    if (tx && matchesReceipt(tx, r, tz)) continue
    const next = receiptTransaction(r, ctx, tx)
    if (next) ops.push({ op: 'put', collection: 'transactions', item: next })
  }
  for (const r of before) {
    if (keep.has(r.txId)) continue
    const tx = txs.get(r.txId)
    if (tx?.source) ops.push({ op: 'remove', collection: 'transactions', id: r.txId })
  }
  return ops
}

/** Incomes still to create: payments whose income doesn't exist yet (waiting for a rate, or interrupted). */
export function missingReceipts(receipts: Receipt[], transactions: Transaction[]): Receipt[] {
  const ids = new Set(transactions.map((t) => t.id))
  return receipts.filter((r) => !ids.has(r.txId))
}

/** Deleting a project/sale: its incomes stay in Financeiro (money received), without the link. */
export function unlinkOps(transactions: Transaction[], belongs: (s: ReceiptSource) => boolean): BatchOp[] {
  return transactions
    .filter((t) => t.source && belongs(t.source))
    .map((t) => {
      const { source: _drop, ...rest } = t
      void _drop
      return { op: 'put', collection: 'transactions', item: { ...rest, updatedAt: new Date().toISOString() } } satisfies BatchOp
    })
}

export const belongsToProject = (projectId: string) => (s: ReceiptSource) => s.kind === 'project' && s.parentId === projectId

/** A sale's own payments and the general payments that have a piece in it. */
export const belongsToSale = (sale: Sale) => {
  const generals = new Set(sale.payments.map((p) => p.generalId).filter(Boolean))
  return (s: ReceiptSource) => (s.kind === 'sale' && s.parentId === sale.id) || (s.kind === 'saleGeneral' && generals.has(s.paymentId))
}
