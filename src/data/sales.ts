import { daysBetween, fromDateInput } from '../lib/dates'
import { normalize } from './selectors'
import type { Cents, Currency, Payment, Sale } from './types'

export type SaleStatus = 'pending' | 'partial' | 'paid'

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  pending: 'Pendente',
  partial: 'Parcialmente pago',
  paid: 'Quitado',
}

/** Paid amount always comes from the payment history, never from a separate field. */
export function salePaid(sale: Pick<Sale, 'payments'>): Cents {
  return sale.payments.reduce((sum, p) => sum + p.amount, 0)
}

export function saleRemaining(sale: Pick<Sale, 'payments' | 'total'>): Cents {
  return Math.max(sale.total - salePaid(sale), 0)
}

export function saleStatus(sale: Pick<Sale, 'payments' | 'total'>): SaleStatus {
  const paid = salePaid(sale)
  if (paid >= sale.total && sale.total > 0) return 'paid'
  return paid > 0 ? 'partial' : 'pending'
}

export function isOverdue(sale: Sale, today = new Date()): boolean {
  const due = fromDateInput(sale.dueDate)
  return Boolean(due) && saleStatus(sale) !== 'paid' && daysBetween(today, due!) < 0
}

/** Shown when a payment is bigger than what is still owed (the form offers “Usar o valor que falta”). */
export const OVERPAY = 'O valor passa do que falta'

/** Returns an error message, or null when the payment can be added. */
export function paymentProblem(sale: Pick<Sale, 'payments' | 'total'>, payment: Pick<Payment, 'amount' | 'date' | 'id'>): string | null {
  if (!payment.amount || payment.amount <= 0) return 'Digite o valor recebido'
  if (!fromDateInput(payment.date)) return 'Informe a data do pagamento'
  // When editing a payment, the old value of that same payment doesn't count.
  const others = sale.payments.filter((p) => p.id !== payment.id)
  const remaining = sale.total - others.reduce((s, p) => s + p.amount, 0)
  if (payment.amount > remaining) return OVERPAY
  return null
}

/** Total can't drop below what was already received. */
export function totalProblem(total: Cents | null, payments: Payment[]): string | null {
  if (total === null || total <= 0) return 'Digite o valor total da venda'
  const paid = payments.reduce((s, p) => s + p.amount, 0)
  if (total < paid) return 'O total não pode ser menor que o já recebido'
  return null
}

/** Adds (or replaces, same id) a payment. Replaying the same payment never counts it twice. */
export function withPayment(sale: Sale, payment: Payment): Sale {
  const payments = sale.payments.some((p) => p.id === payment.id) ? sale.payments.map((p) => (p.id === payment.id ? payment : p)) : [...sale.payments, payment]
  return { ...sale, payments: payments.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) }
}

export interface SaleFilter {
  query: string
  status: SaleStatus | 'all' | 'overdue'
  from: string
  to: string
  clientKey: string
}

/** Same client whether it's linked to Clients or typed by hand. */
export function clientKey(sale: Pick<Sale, 'clientId' | 'clientName'>): string {
  return sale.clientId ? `id:${sale.clientId}` : `name:${personName(sale.clientName)}`
}

// ---------- People (Vendas por pessoa) ----------
// Everything below is derived from the sales and their payments: nothing is stored twice.

/** "  Maria   José " and "maria jose" are the same person typed by hand. */
export function personName(name: string): string {
  return normalize(name).replace(/\s+/g, ' ')
}

export type BuyerStatus = 'paid' | 'partial' | 'pending'

export const BUYER_STATUS_LABEL: Record<BuyerStatus, string> = { paid: 'Pago', partial: 'Parcial', pending: 'Pendente' }

export const BUYER_TONE = { paid: 'positive', partial: 'accent', pending: 'neutral' } as const

/** Totals of one currency. Different currencies are never added together. */
export interface MoneyTotals {
  currency: Currency
  total: Cents
  paid: Cents
  remaining: Cents
}

export interface Buyer {
  key: string
  name: string
  clientId: string | null
  /** Oldest first. */
  sales: Sale[]
  totals: MoneyTotals[]
  status: BuyerStatus
  /** Latest purchase date ("YYYY-MM-DD"). */
  lastDate: string
}

/** Oldest purchase first (date, then creation time). */
export function byOldest(a: Sale, b: Sale): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

export function totalsByCurrency(sales: Sale[]): MoneyTotals[] {
  const map = new Map<Currency, MoneyTotals>()
  for (const s of sales) {
    const t = map.get(s.currency) ?? { currency: s.currency, total: 0, paid: 0, remaining: 0 }
    const paid = Math.min(salePaid(s), s.total)
    t.total += s.total
    t.paid += paid
    t.remaining += s.total - paid
    map.set(s.currency, t)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

export function buyerStatus(totals: MoneyTotals[]): BuyerStatus {
  if (totals.every((t) => t.remaining <= 0)) return 'paid'
  return totals.some((t) => t.paid > 0) ? 'partial' : 'pending'
}

/** The spelling used most often (ties: the most recent), e.g. "Maria" rather than " maria ". */
function displayName(names: string[]): string {
  const count = new Map<string, number>()
  for (const n of names) count.set(n.trim(), (count.get(n.trim()) ?? 0) + 1)
  let best = ''
  for (const n of names.map((x) => x.trim())) if (!best || count.get(n)! >= count.get(best)!) best = n
  return best
}

/** One entry per person, grouping every purchase with the same client / same typed name. */
export function buyers(sales: Sale[], nameOf: (s: Sale) => string): Buyer[] {
  const groups = new Map<string, Sale[]>()
  for (const s of sales) {
    const key = clientKey(s)
    const list = groups.get(key)
    if (list) list.push(s)
    else groups.set(key, [s])
  }
  return [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort(byOldest)
    const totals = totalsByCurrency(sorted)
    const latest = sorted[sorted.length - 1]
    return { key, name: displayName(sorted.map(nameOf)), clientId: latest.clientId, sales: sorted, totals, status: buyerStatus(totals), lastDate: latest.date }
  })
}

/** Top of Vendas: sold / received / to receive per currency, and how many people still owe. */
export function salesOverview(sales: Sale[], nameOf: (s: Sale) => string) {
  const people = buyers(sales, nameOf)
  return { totals: totalsByCurrency(sales), owing: people.filter((b) => b.status !== 'paid').length }
}

/** A line of a person's payment history: one specific payment, or one general payment (all its pieces). */
export interface PaymentEntry {
  id: string
  kind: 'general' | 'specific'
  date: string
  amount: Cents
  currency: Currency
  note: string
  /** Where the money went. For a general payment: split automatically by the app. */
  parts: { saleId: string; product: string; paymentId: string; amount: Cents }[]
}

export function buyerPayments(sales: Sale[]): PaymentEntry[] {
  const out: PaymentEntry[] = []
  const general = new Map<string, PaymentEntry>()
  for (const s of [...sales].sort(byOldest)) {
    for (const p of s.payments) {
      const part = { saleId: s.id, product: s.product, paymentId: p.id, amount: p.amount }
      if (p.generalId) {
        const key = `${p.generalId}:${s.currency}`
        const entry = general.get(key)
        if (entry) {
          entry.amount += p.amount
          entry.parts.push(part)
        } else {
          const e: PaymentEntry = { id: p.generalId, kind: 'general', date: p.date, amount: p.amount, currency: s.currency, note: p.note, parts: [part] }
          general.set(key, e)
          out.push(e)
        }
      } else out.push({ id: p.id, kind: 'specific', date: p.date, amount: p.amount, currency: s.currency, note: p.note, parts: [part] })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** What a person still owes in one currency. */
export function owedIn(sales: Sale[], currency: Currency): Cents {
  return sales.filter((s) => s.currency === currency).reduce((sum, s) => sum + saleRemaining(s), 0)
}

/**
 * A "Pagamento geral": not tied to a product. The app splits it across the
 * person's open purchases in that currency, oldest first. Each piece is a normal
 * payment of one sale (so it is counted exactly once) carrying the same generalId.
 * Returns only the sales that changed, or an error.
 */
export function applyGeneralPayment(
  sales: Sale[],
  input: { generalId: string; currency: Currency; amount: Cents | null; date: string; note: string },
  newPaymentId: () => string,
): { changed: Sale[] } | { error: string } {
  if (!input.amount || input.amount <= 0) return { error: 'Digite o valor recebido' }
  if (!fromDateInput(input.date)) return { error: 'Informe a data do pagamento' }
  if (input.amount > owedIn(sales, input.currency)) return { error: OVERPAY }
  let left = input.amount
  const changed: Sale[] = []
  for (const s of sales.filter((x) => x.currency === input.currency).sort(byOldest)) {
    if (left <= 0) break
    const piece = Math.min(saleRemaining(s), left)
    if (piece <= 0) continue
    // finance: the general payment becomes one income in Financeiro (data/receipts.ts).
    changed.push(withPayment(s, { id: newPaymentId(), date: input.date, amount: piece, note: input.note, generalId: input.generalId, finance: true }))
    left -= piece
  }
  return { changed }
}

/** Removing a general payment removes all of its pieces (returns the sales that changed). */
export function withoutGeneralPayment(sales: Sale[], generalId: string): Sale[] {
  return sales.filter((s) => s.payments.some((p) => p.generalId === generalId)).map((s) => ({ ...s, payments: s.payments.filter((p) => p.generalId !== generalId) }))
}

/** Existing people whose name looks like what is being typed (to pick instead of creating a duplicate). */
export function similarPeople<T extends { name: string }>(people: T[], typed: string, limit = 4): T[] {
  const q = personName(typed)
  if (q.length < 2) return []
  return people.filter((p) => personName(p.name).includes(q)).slice(0, limit)
}
