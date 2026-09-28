import { motion } from 'framer-motion'
import { useId } from 'react'

interface SegmentedProps<V extends string> {
  value: V
  onChange(v: V): void
  options: { value: V; label: string; disabled?: boolean }[]
  size?: 'sm' | 'md'
  block?: boolean
  label?: string
}

export function Segmented<V extends string>({ value, onChange, options, size = 'md', block, label }: SegmentedProps<V>) {
  const id = useId()
  const h = size === 'sm' ? 'h-8 text-[13px] px-3' : 'h-10 text-sm px-3.5'
  return (
    <div role="radiogroup" aria-label={label} className={`flex shrink-0 rounded-[0.9rem] border border-line bg-raised p-1 ${block ? 'w-full' : 'w-fit'}`}>
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
            className={`relative rounded-[0.65rem] font-medium whitespace-nowrap transition-colors disabled:opacity-35 ${h} ${block ? 'flex-1' : ''} ${active ? 'text-ink' : 'text-faint hover:text-soft'}`}
          >
            {active && (
              <motion.span
                layoutId={id}
                className="absolute inset-0 rounded-[0.65rem] bg-elevated shadow-sm shadow-black/40 ring-1 ring-white/[0.06]"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
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
    <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`press h-9 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap ${
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
