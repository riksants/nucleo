import { ChevronDown, Ellipsis } from 'lucide-react'
import { useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { useStore } from '../data/store'
import type { Currency } from '../data/types'
import { currencyInfo } from '../lib/money'
import { CurrencySheet, quickCurrencies } from './CurrencySheet'
import { Segmented } from './Segmented'

const CONTROL =
  'w-full rounded-[var(--radius-field)] border border-line bg-raised px-4 text-ink placeholder:text-faint transition-colors focus:border-accent/70 focus:bg-elevated focus:outline-none'

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between gap-2 text-[13px] font-medium tracking-wide text-soft uppercase">
        {label}
        {hint && <span className="text-xs font-normal tracking-normal text-faint normal-case">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1.5 block text-sm text-expense">{error}</span>}
    </label>
  )
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} h-12 ${className}`} {...rest} />
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} min-h-28 resize-y py-3 leading-relaxed ${className}`} {...rest} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={`${CONTROL} h-12 appearance-none pr-10 ${className}`} {...rest}>
        {children}
      </select>
      <ChevronDown size={18} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-faint" />
    </div>
  )
}

/** Amount text + currency picker, laid out as one control. */
export function MoneyInput({
  value,
  onChange,
  currency,
  onCurrency,
  placeholder = '0,00',
  autoFocus,
}: {
  value: string
  onChange(v: string): void
  currency: Currency
  onCurrency(c: Currency): void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-soft">{currencyInfo(currency).symbol}</span>
        <input
          className={`${CONTROL} num h-12`}
          style={{ paddingLeft: currency === 'AED' ? 48 : currency === 'BRL' ? 44 : currency === 'EUR' ? 36 : 22 + currencyInfo(currency).symbol.length * 9 }}
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <CurrencyPicker value={currency} onChange={onCurrency} />
    </div>
  )
}

/**
 * The person's quick currencies as a segmented control, plus "…" to search any other.
 * `isDisabled` lets a form block currencies it cannot convert.
 */
export function CurrencyPicker({
  value,
  onChange,
  size = 'md',
  block,
  label,
  isDisabled,
  format = (c) => c,
}: {
  value: Currency
  onChange(c: Currency): void
  size?: 'sm' | 'md'
  block?: boolean
  label?: string
  isDisabled?(c: Currency): boolean
  format?(c: Currency): string
}) {
  const { settings } = useStore()
  const [searching, setSearching] = useState(false)
  const quick = quickCurrencies(settings).slice(0, 3)
  const shown = quick.includes(value) ? quick : [...quick, value]
  const options = shown.map((c) => ({ value: c, label: format(c), disabled: isDisabled?.(c) }))
  return (
    <div className={`flex items-center gap-1.5 ${block ? 'w-full' : ''}`}>
      <div className={block ? 'min-w-0 flex-1' : ''}>
        <Segmented size={size} block={block} label={label} value={value} onChange={onChange} options={options} />
      </div>
      <button
        type="button"
        aria-label="Outras moedas"
        title="Outras moedas"
        onClick={() => setSearching(true)}
        className={`press grid shrink-0 place-items-center rounded-[0.9rem] border border-line bg-raised text-soft hover:text-ink ${size === 'sm' ? 'size-10' : 'size-12'}`}
      >
        <Ellipsis size={18} />
      </button>
      <CurrencySheet
        open={searching}
        onClose={() => setSearching(false)}
        value={value}
        onPick={(c) => {
          if (isDisabled?.(c)) return
          onChange(c)
        }}
      />
    </div>
  )
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 pt-2 sm:grid-cols-2 [&>*]:sm:col-span-2 [&>.half]:sm:col-span-1">{children}</div>
}
