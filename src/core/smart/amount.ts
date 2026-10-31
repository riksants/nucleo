/**
 * The one reader of money in sentences (Etapa 4). Every smart reader (Cadastro inteligente, Assistente, regras,
 * importação de texto) uses it, so "R$ 1.200", "1,5 mil", "12 euros", "€12", "AED 300" mean the same everywhere.
 *
 * Honest by design: the currency is only what was written ("R$", "euros", "€", "AED"…). Nothing said → null, and
 * the screen asks. "$" alone is not a currency (dólar americano? real? peso?) → null as well.
 */
import type { Cents, Currency } from '../../data/types'

/** Lowercase without accents, same length as the input (positions map back to the original). */
export function foldSame(s: string): string {
  return [...s].map((c) => (c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() || c)[0] ?? c).join('')
}

/** Words and symbols of currencies, checked on folded text. Longest first ("us$" before "$"). */
const SYMBOLS: [string, Currency][] = [
  ['r$', 'BRL'],
  ['us$', 'USD'],
  ['u$s', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
]
const WORDS: [RegExp, Currency][] = [
  [/^(reais|real|brl)$/, 'BRL'],
  [/^(euros?|eur)$/, 'EUR'],
  [/^(dolares|dolar|usd)$/, 'USD'],
  [/^(dirhams?|aed)$/, 'AED'],
  [/^(libras?|gbp)$/, 'GBP'],
]
const CODE = /^(brl|eur|usd|aed|gbp|chf|jpy|cad|aud|mxn|ars|clp|cop)$/

export interface AmountFound {
  cents: Cents
  /** As written; null when the sentence doesn't say. */
  currency: Currency | null
  /** Folded text of the whole match (to remove it from a title). */
  match: string
  index: number
  /** "mil" / "k" was used. */
  thousands: boolean
}

function wordCurrency(w: string): Currency | null {
  for (const [re, c] of WORDS) if (re.test(w)) return c
  return CODE.test(w) ? w.toUpperCase() : null
}

/** "1.234,56" / "1234,5" / "12.50" / "1,5" → number (pt-BR first: a dot followed by 3 digits is thousands). */
export function numberOf(raw: string): number | null {
  const s = raw.trim()
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return Number(s.replace(/,/g, ''))
  if (/^\d+,\d{1,2}$/.test(s)) return Number(s.replace(',', '.'))
  if (/^\d+\.\d{1,2}$/.test(s)) return Number(s)
  if (/^\d+$/.test(s)) return Number(s)
  return null
}

const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const RE = new RegExp(String.raw`(r\$|us\$|u\$s|€|£|\$|\b(?:brl|eur|usd|aed|gbp)\b)?\s*(${NUM})(?!\d)\s*(mil\b|k\b)?\s*(€|\b(?:reais|real|euros?|dolares|dolar|dirhams?|libras?|brl|eur|usd|aed|gbp)\b)?`, 'g')

/**
 * Every amount in a sentence. `strict` (default): only numbers that look like money — a currency, "mil",
 * cents, or a verb of money right before ("gastei 45") — so "às 14h", "dia 15" and "3 vezes" are never money.
 */
export function readAmounts(text: string, opts: { strict?: boolean } = {}): AmountFound[] {
  const t = foldSame(text)
  const out: AmountFound[] = []
  for (const m of t.matchAll(RE)) {
    const [whole, pre, num, mil, post] = m
    const index = m.index ?? 0
    const value = numberOf(num)
    if (value === null || !Number.isFinite(value) || value <= 0) continue
    // Parts of dates, times and counts are not money: "15/10", "14h", "14:30", "dia 5", "às 3", "3x", "3 vezes".
    const numStart = index + whole.indexOf(num)
    const numEnd = numStart + num.length
    const after = t.slice(numEnd, numEnd + 12)
    const before = t.slice(Math.max(0, numStart - 6), numStart)
    if (!pre && !post && !mil) {
      if (/^([/:]|h(?![a-z])|h\d|x(?![a-z])|\s*(vezes|parcelas|dias|semanas|meses|anos|horas|min|minutos|kg|g\b|ml|l\b|series|reps|repeticoes|pessoas|unidades|itens)\b)/.test(after)) continue
      if (/[/:]$/.test(before) || /\b(dia|as|ate)\s*$/.test(before)) continue
    }
    const preCur = pre ? (SYMBOLS.find(([s]) => s === pre)?.[1] ?? (pre === '$' ? null : wordCurrency(pre))) : null
    const postCur = post ? (post === '€' ? 'EUR' : wordCurrency(post)) : null
    const currency = preCur ?? postCur
    const strict = opts.strict ?? true
    const moneyVerb = /\b(gastei|gasto|paguei|pago|pagar|recebi|receber|ganhei|custou|custa|custando|por|de|vendi|comprei|valor|total|deu|deve|devendo|falta|sobrou|guardar|juntar|economizar|reservar)\s*$/.test(t.slice(Math.max(0, index - 14), index))
    const cents = /[.,]\d{1,2}$/.test(num) && !/^\d{1,3}([.,]\d{3})+$/.test(num)
    if (strict && !currency && !mil && !pre && !cents && !moneyVerb) continue
    const v = value * (mil ? 1000 : 1)
    out.push({ cents: Math.round(v * 100), currency, match: whole.trim(), index: index + (whole.length - whole.trimStart().length), thousands: Boolean(mil) })
  }
  return out
}

/** The first amount (or null). */
export function readAmount(text: string, opts: { strict?: boolean } = {}): AmountFound | null {
  return readAmounts(text, opts)[0] ?? null
}

/** The person's currencies in the order they see them (main first). */
export function knownCurrencies(settings: { baseCurrency: Currency; currencies?: Currency[] }): Currency[] {
  return [...new Set([settings.baseCurrency, ...(settings.currencies ?? [])])]
}

/**
 * A currency may be taken without asking only when the person uses exactly one (no list, or a list with only
 * the main one). Everyone else is asked — the Núcleo never guesses money.
 */
export function onlyCurrency(settings: { baseCurrency: Currency; currencies?: Currency[] }): Currency | null {
  const list = settings.currencies
  if (list && list.length > 0 && list.every((c) => c === settings.baseCurrency)) return settings.baseCurrency
  return null
}
