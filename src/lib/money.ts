import type { Cents, Currency } from '../data/types'

export const CURRENCY_INFO: Record<Currency, { symbol: string; label: string; locale: string }> = {
  EUR: { symbol: '€', label: 'Euro', locale: 'pt-PT' },
  BRL: { symbol: 'R$', label: 'Real', locale: 'pt-BR' },
  AED: { symbol: 'د.إ', label: 'Dirham', locale: 'pt-PT' },
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
  if (currency === 'AED') return `${sign}${n} د.إ`
  return `${sign}${CURRENCY_INFO[currency].symbol} ${n}`
}
