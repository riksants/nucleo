/**
 * Saldo, Reservado e Disponível. Nothing here is stored:
 * - Saldo: initial balance + every movement (selectors.balanceOf), as always;
 * - Reservado: the saved amount of the active goals marked "Este dinheiro está no meu saldo",
 *   each kept in its own currency and converted only to add up (never rewritten by a rate change);
 * - Disponível: Saldo − Reservado.
 * Reserving money for a goal never creates a movement. A goal whose currency has no rate stays
 * out of the sum and is listed in `missing` (never an invented conversion).
 */
import type { Cents, Currency, FinanceGoal } from '../data/types'
import type { Converter } from '../lib/rates'

export interface ReserveSummary {
  balance: Cents
  reserved: Cents
  available: Cents
  /** Currency of the three values (the base currency of the balance). */
  currency: Currency
  /** Currencies of reserving goals that could not be converted (not counted). */
  missing: Currency[]
  /** At least one goal reserves money from the balance. */
  hasReserve: boolean
}

/** Goals whose saved money is part of the balance. */
export function reservingGoals(goals: FinanceGoal[]): FinanceGoal[] {
  return goals.filter((g) => g.status === 'active' && g.inBalance === true)
}

export function reserveSummary(goals: FinanceGoal[], balanceBase: Cents, base: Currency, convert: Converter): ReserveSummary {
  let reserved = 0
  const missing: Currency[] = []
  const reserving = reservingGoals(goals)
  for (const g of reserving) {
    const value = convert(Math.max(g.saved, 0), g.currency, base)
    if (value === null) {
      if (!missing.includes(g.currency)) missing.push(g.currency)
    } else reserved += value
  }
  return { balance: balanceBase, reserved, available: balanceBase - reserved, currency: base, missing, hasReserve: reserving.length > 0 }
}
