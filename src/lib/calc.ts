/**
 * Tiny calculator for the amount field ("2500 + 750 + 120"). No eval: the text
 * is split into numbers and operators, each number read with the same rules as
 * a plain amount (parseAmount: "1.500,50", "1500.50", "1,5"…), then evaluated
 * with the usual precedence (× and ÷ before + and −). Works in cents.
 */
import type { Cents } from '../data/types'
import { formatNumber, parseAmount } from './money'

export type CalcOp = '+' | '-' | '*' | '/'

/** Typed or tapped symbols → the four operators. */
const OPS: Record<string, CalcOp> = { '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', x: '*', X: '*', '/': '/', '÷': '/' }
const OP_CHARS = new Set(Object.keys(OPS))

export type CalcResult = { ok: true; cents: Cents; isExpression: boolean } | { ok: false; error: 'empty' | 'invalid' | 'divideByZero' | 'notPositive' }

/** "100 + 50 × 2" → [100, '+', 50, '*', 2] (numbers in cents), or null when malformed. */
function tokenize(text: string): (Cents | CalcOp)[] | null {
  const out: (Cents | CalcOp)[] = []
  let number = ''
  const flush = () => {
    const t = number.trim()
    number = ''
    if (!t) return false
    const cents = parseAmount(t)
    if (cents === null) return null
    out.push(cents)
    return true
  }
  for (const ch of text) {
    if (OP_CHARS.has(ch)) {
      const r = flush()
      if (r !== true) return null // operator with no number before it, or an invalid number
      out.push(OPS[ch])
    } else number += ch
  }
  const r = flush()
  if (r === null) return null
  if (r === false && out.length) return null // ends with an operator
  return out
}

/** Value of the text in cents (a single number or an expression). Never NaN/Infinity. */
export function evaluate(text: string): CalcResult {
  if (!text.trim()) return { ok: false, error: 'empty' }
  const tokens = tokenize(text)
  if (!tokens || !tokens.length) return { ok: false, error: 'invalid' }
  // Values as plain amounts (not cents) while multiplying/dividing.
  const values: number[] = [(tokens[0] as number) / 100]
  const ops: ('+' | '-')[] = []
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i] as CalcOp
    const v = (tokens[i + 1] as number) / 100
    if (op === '*') values[values.length - 1] *= v
    else if (op === '/') {
      if (v === 0) return { ok: false, error: 'divideByZero' }
      values[values.length - 1] /= v
    } else {
      ops.push(op)
      values.push(v)
    }
  }
  let total = values[0]
  for (let i = 0; i < ops.length; i++) total = ops[i] === '+' ? total + values[i + 1] : total - values[i + 1]
  const cents = Math.round(total * 100)
  if (!Number.isFinite(cents) || !Number.isSafeInteger(cents)) return { ok: false, error: 'invalid' }
  if (cents <= 0) return { ok: false, error: 'notPositive' }
  return { ok: true, cents, isExpression: tokens.length > 1 }
}

export const CALC_ERROR: Record<Exclude<CalcResult, { ok: true }>['error'], string> = {
  empty: 'Digite um valor',
  invalid: 'Confira a conta',
  divideByZero: 'Não dá para dividir por zero',
  notPositive: 'O resultado precisa ser maior que zero',
}

/** Has at least one operator (so the result line is shown). */
export const isExpression = (text: string) => [...text].some((ch, i) => OP_CHARS.has(ch) && i > 0)

/** "100 +" — still being typed, so no error is shown yet. */
export function endsWithOperator(text: string): boolean {
  const t = text.trimEnd()
  return t.length > 0 && OP_CHARS.has(t[t.length - 1])
}

/** Tapping an operator: appends it, or replaces a trailing one (never two in a row). */
export function appendOperator(text: string, op: CalcOp): string {
  const symbol = op === '*' ? '×' : op === '/' ? '÷' : op === '-' ? '−' : '+'
  const trimmed = text.trimEnd()
  if (!trimmed) return text
  const last = trimmed[trimmed.length - 1]
  if (OP_CHARS.has(last)) return `${trimmed.slice(0, -1).trimEnd()} ${symbol} `
  return `${trimmed} ${symbol} `
}

/** "=" : the expression becomes its result, in the app's number format ("3.370", "12,50"). */
export function resultText(cents: Cents): string {
  return formatNumber(cents, { compact: true })
}
