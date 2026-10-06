import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { normalize } from '../data/selectors'
import { useStore } from '../data/store'
import { LEGACY_CURRENCIES, type Currency, type Settings } from '../data/types'
import { allCurrencyCodes, currencyInfo } from '../lib/money'
import { effectiveRates } from '../lib/rates'
import { Badge, SearchField } from './Display'
import { Sheet } from './Sheet'

/** Currencies shown first in pickers. People from before keep EUR/BRL/AED. */
export function quickCurrencies(settings: Settings, extra: Currency[] = []): Currency[] {
  const base = settings.currencies?.length ? settings.currencies : LEGACY_CURRENCIES
  return [...new Set([...base, ...extra])]
}

/** Searchable list of every currency, by code or name ("dolar", "yen", "CHF"). */
export function CurrencySheet({ open, onClose, value, onPick, title = 'Escolher moeda' }: { open: boolean; onClose(): void; value?: Currency; onPick(c: Currency): void; title?: string }) {
  const { settings } = useStore()
  const [query, setQuery] = useState('')
  const rates = effectiveRates(settings)
  const codes = useMemo(() => {
    const quick = quickCurrencies(settings)
    const rest = allCurrencyCodes().filter((c) => !quick.includes(c))
    return [...quick, ...rest]
  }, [settings])
  const q = normalize(query)
  const list = q ? codes.filter((c) => normalize(c).includes(q) || normalize(currencyInfo(c).label).includes(q)) : codes

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-3">
        <SearchField value={query} onChange={setQuery} placeholder="Buscar por nome ou código" />
      </div>
      <div className="divide-y divide-line">
        {list.slice(0, 200).map((c) => {
          const info = currencyInfo(c)
          const active = c === value
          return (
            <button
              key={c}
              type="button"
              onClick={() => {
                onPick(c)
                setQuery('')
                onClose()
              }}
              className="flex min-h-14 w-full items-center gap-3 px-1 text-left transition-colors hover:bg-tint/[0.03] tap"
            >
              <span className="grid h-9 min-w-11 place-items-center rounded-xl bg-elevated px-1.5 text-[13px] font-semibold">{info.symbol}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">{info.label}</span>
                <span className="text-[13px] text-faint">{c}</span>
              </span>
              {rates && !rates[c] && <Badge>sem cotação</Badge>}
              {active && <Check size={18} className="text-accent-hi" />}
            </button>
          )
        })}
        {list.length === 0 && <p className="py-6 text-center text-[15px] text-faint">Nenhuma moeda encontrada</p>}
      </div>
    </Sheet>
  )
}
