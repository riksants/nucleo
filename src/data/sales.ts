import { daysBetween, fromDateInput } from '../lib/dates'
import type { Cents, Payment, Sale } from './types'

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

/** Returns an error message, or null when the payment can be added. */
export function paymentProblem(sale: Pick<Sale, 'payments' | 'total'>, payment: Pick<Payment, 'amount' | 'date' | 'id'>): string | null {
  if (!payment.amount || payment.amount <= 0) return 'Digite o valor recebido'
  if (!fromDateInput(payment.date)) return 'Informe a data do pagamento'
  // When editing a payment, the old value of that same payment doesn't count.
  const others = sale.payments.filter((p) => p.id !== payment.id)
  const remaining = sale.total - others.reduce((s, p) => s + p.amount, 0)
  if (payment.amount > remaining) return 'O valor passa do que falta receber'
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
  return sale.clientId ? `id:${sale.clientId}` : `name:${sale.clientName.trim().toLowerCase()}`
}
