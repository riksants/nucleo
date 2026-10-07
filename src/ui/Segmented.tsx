import { motion } from 'framer-motion'
import { useId } from 'react'

interface SegmentedProps<V extends string> {
  value: V
  onChange(v: V): void
  options: { value: V; label: string; disabled?: boolean }[]
  size?: 'sm' | 'md'
  block?: boolean
  label?: string
  /** pill (default): a sliding pill in a track · underline: tabs with a sliding underline (period of Financeiro). */
  variant?: 'pill' | 'underline'
  /** glass: for the colored balance card (white on purple). */
  tone?: 'default' | 'glass'
}

export function Segmented<V extends string>({ value, onChange, options, size = 'md', block, label, variant = 'pill', tone = 'default' }: SegmentedProps<V>) {
  const id = useId()
  const h = size === 'sm' ? 'h-8 text-[13px] px-3' : 'h-10 text-sm px-3.5'
  if (variant === 'underline') {
    return (
      <div role="radiogroup" aria-label={label} className="no-scrollbar flex w-full min-w-0 gap-5 overflow-x-auto border-b border-line">
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className={`relative flex h-11 shrink-0 items-end pb-2.5 text-[15px] font-semibold whitespace-nowrap transition-colors disabled:opacity-35 ${active ? 'text-ink' : 'text-faint hover:text-soft'}`}
            >
              {o.label}
              {active && <motion.span layoutId={id} className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 45 }} />}
            </button>
          )
        })}
      </div>
    )
  }
  const glass = tone === 'glass'
  return (
    <div role="radiogroup" aria-label={label} className={`flex shrink-0 rounded-full border p-1 ${glass ? 'border-white/20 bg-white/12' : 'border-line bg-raised'} ${block ? 'w-full' : 'w-fit'}`}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`hit relative rounded-full font-semibold whitespace-nowrap transition-colors disabled:opacity-35 ${h} ${block ? 'flex-1' : ''} ${glass ? (active ? 'text-accent-on-white' : 'text-white/75 hover:text-white') : active ? 'text-ink' : 'text-faint hover:text-soft'}`}
          >
            {active && (
              <motion.span
                layoutId={id}
                className={`absolute inset-0 rounded-full ${glass ? 'bg-white shadow-sm shadow-black/20' : 'bg-elevated shadow-sm shadow-shade/40 ring-1 ring-tint/[0.06]'}`}
                transition={{ type: 'spring', stiffness: 500, damping: 45 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Horizontally scrolling filter chips, for longer option lists. */
export function Chips<V extends string>({ value, onChange, options }: Omit<SegmentedProps<V>, 'size' | 'block'>) {
  return (
    <div className="no-scrollbar -mx-5 -my-1 flex gap-2 overflow-x-auto px-5 py-1 lg:mx-0 lg:flex-wrap lg:px-0">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`press hit relative h-9 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap ${
              active ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-soft hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
