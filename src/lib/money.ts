import type { Cents, Currency } from '../data/types'

interface CurrencyInfo {
  symbol: string
  label: string
  /** Symbol goes after the number (AED is RTL text). */
  suffix: boolean
}

/** Hand-tuned entries for the original three currencies, so their look stays exactly the same. */
const KNOWN: Record<string, CurrencyInfo> = {
  EUR: { symbol: '€', label: 'Euro', suffix: false },
  BRL: { symbol: 'R$', label: 'Real', suffix: false },
  AED: { symbol: 'د.إ', label: 'Dirham', suffix: true },
  USD: { symbol: 'US$', label: 'Dólar americano', suffix: false },
}

const cache = new Map<string, CurrencyInfo>()
let displayNames: Intl.DisplayNames | null = null

let supported: Set<string> | null = null

/** A real ISO 4217 currency known by the browser (rejects crypto and made-up codes). */
export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false
  if (!supported) {
    try {
      supported = new Set(Intl.supportedValuesOf('currency'))
    } catch {
      supported = new Set(Object.keys(KNOWN))
    }
  }
  return supported.has(code) || code in KNOWN
}

export function currencyInfo(code: Currency): CurrencyInfo {
  const known = KNOWN[code] ?? cache.get(code)
  if (known) return known
  let symbol = code
  let label = code
  try {
    symbol = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).formatToParts(1).find((p) => p.type === 'currency')?.value ?? code
  } catch {
    // unknown code: show it as is
  }
  try {
    displayNames ??= new Intl.DisplayNames('pt-BR', { type: 'currency' })
    const name = displayNames.of(code)
    if (name) label = name[0].toUpperCase() + name.slice(1)
  } catch {
    // DisplayNames unavailable
  }
  const info = { symbol, label, suffix: false }
  cache.set(code, info)
  return info
}

/** Every currency the browser knows, for the search picker. */
export function allCurrencyCodes(): Currency[] {
  try {
    return Intl.supportedValuesOf('currency')
  } catch {
    return Object.keys(KNOWN)
  }
}

/**
 * Accepts the ways a person types money: "300", "1.500,50", "1500.50", "1,5".
 * Returns cents, or null if the text is not a valid positive amount.
 */
export function parseAmount(text: string): Cents | null {
  const raw = text.replace(/[\s€$R]|د\.إ/g, '').trim()
  if (!raw || !/^[\d.,]+$/.test(raw)) return null

  const lastDot = raw.lastIndexOf('.')
  const lastComma = raw.lastIndexOf(',')
  let normalized: string

  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    normalized = raw.split(thousands).join('').replace(decimal, '.')
  } else if (lastComma >= 0) {
    normalized = raw.split('.').join('').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.split('.').join('')
  } else {
    normalized = raw
  }

  if ((normalized.match(/\./g) ?? []).length > 1) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/** Cents → editable text, e.g. 150050 → "1500,5". */
export function amountToInput(cents: Cents): string {
  if (!cents) return ''
  return (cents / 100).toString().replace('.', ',')
}

const formatters = new Map<string, Intl.NumberFormat>()

function numberFormat(decimals: number) {
  const key = String(decimals)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    formatters.set(key, f)
  }
  return f
}

export function formatNumber(cents: Cents, opts: { compact?: boolean } = {}): string {
  const value = Math.abs(cents) / 100
  const decimals = opts.compact && Number.isInteger(value) ? 0 : 2
  return numberFormat(decimals).format(value)
}

/** "€ 1.500,00", "-R$ 20,00". AED symbol goes after the number since it is RTL text. */
export function formatMoney(
  cents: Cents,
  currency: Currency,
  opts: { compact?: boolean; sign?: boolean } = {},
): string {
  const n = formatNumber(cents, opts)
  const sign = cents < 0 ? '−' : opts.sign && cents > 0 ? '+' : ''
  const info = currencyInfo(currency)
  if (info.suffix) return `${sign}${n} ${info.symbol}`
  return `${sign}${info.symbol} ${n}`
}
