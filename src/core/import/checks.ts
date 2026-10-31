/**
 * Etapa 4 — what the preview of a statement points out before anything is written:
 * - transfers between the person's own accounts (the other side already in the Núcleo, from another account,
 *   or both sides in the same file): suggested as "Transferência entre suas contas" — kept as movements, out
 *   of income/expense. A single line that only says "transferência" is never assumed to be own money (paying
 *   someone by transfer is ordinary spending): it only gets a hint the person may tap;
 * - suspicious dates and values (future, very old, zero, far above the rest of the file): pointed out with why;
 * - totals of what will be imported, per currency (never added across currencies).
 */
import type { Cents, Currency, DataState, Transaction } from '../../data/types'
import { addDaysToDate } from '../period'
import type { AnalyzedLine } from './analyze'
import { plain } from './normalize'

/** Words that mean money moved between the person's own accounts (not a payment to someone). */
const OWN_TRANSFER = /\b(entre contas|conta propria|contas proprias|mesma titularidade|transferencia propria|own account|between accounts|to savings|from savings|poupanca|traspaso|cuenta propia|resgate|aplicacao|top ?up|recarga wise|wise top|add money|savings)\b/
const ANY_TRANSFER = /\b(transferencia|transf|transfer|trf|ted|doc|sepa|traspaso|wise|revolut)\b/

export const ownTransferWords = (text: string) => OWN_TRANSFER.test(plain(text))
export const transferWords = (text: string) => ANY_TRANSFER.test(plain(text)) || ownTransferWords(text)

const daysBetween = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

export interface TransferHint {
  /** Suggested by default (strong evidence) or only offered (a hint). */
  suggested: boolean
  why: string
  /** The movement of the other side, already in the Núcleo. */
  pairTxId?: string
  /** The other side in this same file (line index). */
  pairLine?: number
}

/**
 * Transfer suggestions for the lines that would be imported (status "new"). Strong evidence:
 * - the opposite movement (same value and currency, ≤ 3 days) is already in the Núcleo from ANOTHER account
 *   and one of the two texts speaks of a transfer; or
 * - both sides are in this file, from the same day range, and both texts speak of a transfer; or
 * - the text says it is between own accounts ("entre contas", "poupança", "conta própria"…).
 */
export function findTransfers(lines: AnalyzedLine[], data: Pick<DataState, 'transactions'>, account: string): Map<number, TransferHint> {
  const out = new Map<number, TransferHint>()
  const acct = plain(account)
  const taken = new Set<string>()
  const candidates = lines.filter((l) => l.status === 'new' && !l.locked)
  for (const l of candidates) {
    const words = transferWords(l.line.description)
    const pair = data.transactions.find(
      (t: Transaction) =>
        !taken.has(t.id) &&
        t.bank &&
        !t.bank.reconciled &&
        plain(t.bank.account ?? '') !== acct &&
        t.type !== l.type &&
        t.type !== 'adjust' &&
        t.amount === l.amount &&
        t.currency === l.currency &&
        daysBetween(t.bank.day, l.day) <= 3 &&
        !t.transfer?.pairId &&
        (words || transferWords(t.bank.raw) || Boolean(t.transfer)),
    )
    if (pair) {
      taken.add(pair.id)
      out.set(l.i, { suggested: true, pairTxId: pair.id, why: `A outra parte já está no Núcleo: ${pair.type === 'in' ? 'entrada' : 'saída'} de ${pair.bank!.account || 'outra conta'} em ${pair.bank!.day.split('-').reverse().join('/')}.` })
    }
  }
  // Both sides in the same file.
  for (const l of candidates) {
    if (out.has(l.i) || !transferWords(l.line.description)) continue
    const other = candidates.find((o) => o.i !== l.i && !out.has(o.i) && o.type !== l.type && o.amount === l.amount && o.currency === l.currency && daysBetween(o.day, l.day) <= 3 && transferWords(o.line.description))
    if (other) {
      out.set(l.i, { suggested: true, pairLine: other.i, why: 'A entrada e a saída do mesmo valor estão neste arquivo, as duas como transferência.' })
      out.set(other.i, { suggested: true, pairLine: l.i, why: 'A entrada e a saída do mesmo valor estão neste arquivo, as duas como transferência.' })
    }
  }
  for (const l of candidates) {
    if (out.has(l.i)) continue
    if (ownTransferWords(l.line.description)) out.set(l.i, { suggested: true, why: 'O texto diz que é entre contas suas.' })
    else if (transferWords(l.line.description)) out.set(l.i, { suggested: false, why: 'Se for entre contas suas, marque como transferência: não conta como renda nem despesa.' })
  }
  return out
}

/** Suspicious dates and values, with why. `review` moves the line out of the default import. */
export function suspicious(lines: AnalyzedLine[], today: string): Map<number, { text: string; review: boolean }[]> {
  const out = new Map<number, { text: string; review: boolean }[]>()
  const add = (i: number, text: string, review = false) => (out.get(i) ?? out.set(i, []).get(i)!).push({ text, review })
  const byCurrency = new Map<string, number[]>()
  for (const l of lines) if (!l.locked && l.amount > 0) (byCurrency.get(l.currency) ?? byCurrency.set(l.currency, []).get(l.currency)!).push(l.amount)
  const median = new Map<string, number>()
  for (const [c, list] of byCurrency) {
    const s = [...list].sort((a, b) => a - b)
    median.set(c, s[Math.floor(s.length / 2)])
  }
  const old = addDaysToDate(today, -3 * 365)
  for (const l of lines) {
    if (l.locked) continue
    if (l.day > addDaysToDate(today, 1)) add(l.i, 'Data no futuro — confira a data antes de importar.', true)
    else if (l.day < old) add(l.i, 'Data de mais de 3 anos atrás.')
    if (l.amount === 0) add(l.i, 'Valor zero.', true)
    const m = median.get(l.currency) ?? 0
    const list = byCurrency.get(l.currency) ?? []
    if (list.length >= 5 && m > 0 && l.amount >= 20 * m && l.amount >= 100_000) add(l.i, 'Valor muito acima do resto deste extrato — confira.')
  }
  return out
}

export interface CurrencyTotals {
  currency: Currency
  income: Cents
  expense: Cents
  transfers: number
}

/** What will be imported, per currency (transfers counted apart, never as income or expense). */
export function totalsOf(lines: { type: 'in' | 'out'; amount: Cents; currency: Currency; transfer: boolean }[]): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>()
  for (const l of lines) {
    const t = map.get(l.currency) ?? map.set(l.currency, { currency: l.currency, income: 0, expense: 0, transfers: 0 }).get(l.currency)!
    if (l.transfer) t.transfers++
    else if (l.type === 'in') t.income += l.amount
    else t.expense += l.amount
  }
  return [...map.values()]
}
