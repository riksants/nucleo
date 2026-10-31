/**
 * Etapa 4 — text copied from a bank's site or app, pasted into the Núcleo. Two shapes:
 * 1. a table (columns separated by tab or ";"), as most sites copy → read exactly like a CSV;
 * 2. one movement per line: "05/10 MERCADONA VALENCIA -45,20" / "05/10/2026 Salário 2.500,00 C".
 * Honest by design: a value without a sign (or C/D) is never guessed as income or expense — the line comes back
 * "sem sinal" for the person to decide; a date without a year takes the most recent such day not in the future,
 * and says so. Lines that are not movements (headers, balances) are ignored and counted.
 */
import { addDaysToDate } from '../period'
import type { ParsedLine } from './types'
import { inferDecimal, parseAmount, parseDate } from './values'

export const MAX_PASTE_CHARS = 400_000

const BALANCE = /^(saldo|balance|total|saldo anterior|saldo do dia|saldo final|saldo inicial)\b/i
const DATE = /^\s*(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\d{4}-\d{2}-\d{2})\s+/
const AMOUNT = /\s+((?:[+-]|−)?\s?(?:R\$|€|US\$|\$|AED)?\s?[+-]?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})|(?:[+-]|−)?\s?(?:R\$|€|US\$|\$|AED)?\s?[+-]?\d+(?:[.,]\d{1,2})?)\s*(-|C|D|CR|DB)?\s*$/i

export interface PastedRead {
  lines: ParsedLine[]
  /** Lines that were not movements (headers, balances, empty). */
  ignored: number
}

/** The most recent day with this day/month that is not after today. */
function withYear(dd: number, mm: number, today: string): string | null {
  const y = Number(today.slice(0, 4))
  for (const year of [y, y - 1]) {
    const d = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    if (!Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).getUTCDate() === dd && d <= addDaysToDate(today, 1)) return d
  }
  return null
}

/** One movement per line. Returns null when the text has no line in this shape. */
export function readPastedLines(text: string, today: string): PastedRead | null {
  const raw = text.slice(0, MAX_PASTE_CHARS).split(/\r?\n/)
  const amounts: string[] = []
  const found: { row: number; date: string; desc: string; amount: string; mark?: string }[] = []
  let ignored = 0
  raw.forEach((line, k) => {
    const t = line.replace(/\t+/g, ' ').trim()
    if (!t) return
    const d = t.match(DATE)
    const rest = d ? t.slice(d[0].length) : ''
    const a = rest.match(AMOUNT)
    if (!d || !a || BALANCE.test(rest)) {
      ignored++
      return
    }
    const desc = rest.slice(0, rest.length - a[0].length).trim()
    if (!desc || BALANCE.test(desc)) {
      ignored++
      return
    }
    amounts.push(a[1])
    found.push({ row: k + 1, date: d[1], desc, amount: a[1], mark: a[2] })
  })
  if (!found.length) return null
  const decimal = inferDecimal(amounts)
  const lines: ParsedLine[] = found.map((f) => {
    let day: string | null = null
    let note = ''
    const short = f.date.match(/^(\d{1,2})[/.-](\d{1,2})$/)
    if (short) {
      day = withYear(Number(short[1]), Number(short[2]), today)
      note = ' (ano deduzido)'
    } else day = parseDate(f.date, 'dmy')
    const signedRaw = f.amount.replace(/R\$|€|US\$|\$|AED/gi, '').replace(/\s/g, '')
    const cents = parseAmount(signedRaw, decimal)
    const explicitMinus = /^[-−]/.test(signedRaw) || /^\s*[-−]/.test(f.amount)
    const explicitPlus = /^\+/.test(signedRaw)
    const mark = (f.mark ?? '').toUpperCase()
    let amount: number | null = cents === null ? null : Math.abs(cents)
    let error: string | undefined
    if (amount === null) error = 'valor ilegível'
    else if (explicitMinus || mark === '-' || mark === 'D' || mark === 'DB') amount = -amount
    else if (explicitPlus || mark === 'C' || mark === 'CR') amount = +amount
    else error = 'o valor não diz se é entrada ou saída (sem sinal)'
    if (!day && !error) error = 'data ilegível'
    const currency = /R\$/i.test(f.amount) ? 'BRL' : /€/.test(f.amount) ? 'EUR' : /US\$/i.test(f.amount) ? 'USD' : /AED/i.test(f.amount) ? 'AED' : null
    return { row: f.row, day, date: `${f.date}${note}`, amount: error ? null : amount, currency, description: f.desc, ...(error ? { error } : {}) }
  })
  return { lines, ignored }
}
