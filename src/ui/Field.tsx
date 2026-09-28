import { ChevronDown } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { CURRENCIES, type Currency } from '../data/types'
import { CURRENCY_INFO } from '../lib/money'
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
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-soft">{CURRENCY_INFO[currency].symbol}</span>
        <input
          className={`${CONTROL} num h-12 ${currency === 'AED' ? 'pl-12' : currency === 'BRL' ? 'pl-11' : 'pl-9'}`}
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

export function CurrencyPicker({ value, onChange, size = 'md' }: { value: Currency; onChange(c: Currency): void; size?: 'sm' | 'md' }) {
  return <Segmented size={size} value={value} onChange={onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 pt-2 sm:grid-cols-2 [&>*]:sm:col-span-2 [&>.half]:sm:col-span-1">{children}</div>
}
