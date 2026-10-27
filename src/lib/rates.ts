import type { Cents, Currency, Rates, Settings } from '../data/types'
import { isCurrencyCode } from './money'

type RateTable = Record<Currency, number>

/** Two free, keyless sources (both quoted against EUR, both include AED). Tried in order. */
const SOURCES: { name: string; url: string; parse: (json: unknown) => RateTable | null }[] = [
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/EUR',
    parse: (json) => clean((json as { rates?: Record<string, number> }).rates),
  },
  {
    name: 'fawazahmed0/currency-api',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json',
    parse: (json) => clean((json as { eur?: Record<string, number> }).eur),
  },
]

/** Keeps real ISO currencies with positive rates. Requires BRL and AED like before. */
export function clean(raw: Record<string, unknown> | undefined): RateTable | null {
  if (!raw) return null
  const table: RateTable = { EUR: 1 }
  for (const [key, value] of Object.entries(raw)) {
    const code = key.toUpperCase()
    if (typeof value === 'number' && value > 0 && Number.isFinite(value) && isCurrencyCode(code)) table[code] = value
  }
  table.EUR = 1
  return table.BRL && table.AED ? table : null
}

/** Largest move of a rate between two readings a few days apart that is believed (M6). */
export const MAX_RATE_MOVE = 0.2
const COMPARE_WITHIN_MS = 30 * 24 * 60 * 60 * 1000

/**
 * A free source that answers with a broken rate (a wrong decimal, a currency swapped) would be frozen
 * into amounts by automations and imports. A reading is believed only when every currency the person
 * uses moved less than 20% since the last reading (when that one is recent enough to compare).
 */
export function plausibleRates(next: RateTable, previous: Rates | null | undefined, watch: readonly Currency[], now = Date.now()): boolean {
  if (!previous || now - new Date(previous.fetchedAt).getTime() > COMPARE_WITHIN_MS) return true
  for (const code of new Set(watch)) {
    const a = previous.values[code]
    const b = next[code]
    if (code === 'EUR' || !a || !b) continue
    const ratio = b / a
    if (ratio > 1 + MAX_RATE_MOVE || ratio < 1 / (1 + MAX_RATE_MOVE)) return false
  }
  return true
}

/** `previous` and `watch`: the last rates and the currencies the person uses (plausibility check). */
export async function fetchRates(previous: Rates | null = null, watch: readonly Currency[] = []): Promise<Rates | null> {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, { cache: 'no-store' })
      if (!res.ok) continue
      const values = source.parse(await res.json())
      if (values && plausibleRates(values, previous, watch)) return { values, fetchedAt: new Date().toISOString(), source: source.name }
    } catch {
      // offline or source unavailable: try the next one
    }
  }
  return null
}

export const RATES_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Fetched rates with any manual overrides applied. Null when nothing is known. */
export function effectiveRates(settings: Pick<Settings, 'rates' | 'manualRates'>): RateTable | null {
  const table: RateTable = { ...(settings.rates?.values ?? {}) }
  for (const [code, value] of Object.entries(settings.manualRates)) {
    if (value && value > 0) table[code] = value
  }
  table.EUR = 1
  return Object.keys(table).length > 1 ? table : null
}

/** Currencies that can be converted with what is known right now. */
export function convertible(rates: RateTable | null): Set<Currency> {
  return new Set(rates ? Object.keys(rates) : [])
}

export type Converter = (cents: Cents, from: Currency, to: Currency) => Cents | null

/** Never invents a rate: returns null when either side is unknown. */
export function makeConverter(rates: RateTable | null): Converter {
  return (cents, from, to) => {
    if (from === to) return cents
    const a = rates?.[from]
    const b = rates?.[to]
    if (!a || !b) return null
    return Math.round((cents / a) * b)
  }
}
