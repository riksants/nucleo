import type { Cents, Currency, Rates, Settings } from '../data/types'

type RateTable = Record<Currency, number>

/** Two free, keyless sources that both include AED. Tried in order. */
const SOURCES: { name: string; url: string; parse: (json: unknown) => RateTable | null }[] = [
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/EUR',
    parse: (json) => {
      const rates = (json as { rates?: Record<string, number> }).rates
      return rates ? pick(rates.BRL, rates.AED) : null
    },
  },
  {
    name: 'fawazahmed0/currency-api',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json',
    parse: (json) => {
      const rates = (json as { eur?: Record<string, number> }).eur
      return rates ? pick(rates.brl, rates.aed) : null
    },
  },
]

function pick(brl: unknown, aed: unknown): RateTable | null {
  if (typeof brl !== 'number' || typeof aed !== 'number' || brl <= 0 || aed <= 0) return null
  return { EUR: 1, BRL: brl, AED: aed }
}

export async function fetchRates(): Promise<Rates | null> {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, { cache: 'no-store' })
      if (!res.ok) continue
      const values = source.parse(await res.json())
      if (values) return { values, fetchedAt: new Date().toISOString(), source: source.name }
    } catch {
      // offline or source unavailable: try the next one
    }
  }
  return null
}

export const RATES_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Fetched rates with any manual overrides applied. Null when nothing is known. */
export function effectiveRates(settings: Pick<Settings, 'rates' | 'manualRates'>): RateTable | null {
  const base = settings.rates?.values
  const manual = settings.manualRates
  const brl = manual.BRL ?? base?.BRL
  const aed = manual.AED ?? base?.AED
  if (!brl || !aed) return null
  return { EUR: 1, BRL: brl, AED: aed }
}

export type Converter = (cents: Cents, from: Currency, to: Currency) => Cents | null

export function makeConverter(rates: RateTable | null): Converter {
  return (cents, from, to) => {
    if (from === to) return cents
    if (!rates) return null
    return Math.round((cents / rates[from]) * rates[to])
  }
}
