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
  /** onAccent: drawn on the vermilion header band (coal on vermilion). */
  tone?: 'default' | 'onAccent'
}

/** Critically damped: the indicator settles in ~0.2 s without overshoot. */
const SLIDE = { type: 'spring', stiffness: 500, damping: 45 } as const

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
              {active && <motion.span layoutId={id} className="absolute inset-x-0 -bottom-px h-[3px] rounded-t-full bg-accent" transition={SLIDE} />}
            </button>
          )
        })}
      </div>
    )
  }
  const onAccent = tone === 'onAccent'
  return (
    <div role="radiogroup" aria-label={label} className={`flex shrink-0 rounded-full border p-1 ${onAccent ? 'border-coal/15 bg-coal/[0.08]' : 'border-line bg-raised'} ${block ? 'w-full' : 'w-fit'}`}>
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
            className={`hit relative rounded-full font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-35 ${h} ${block ? 'flex-1' : ''} ${onAccent ? (active ? 'text-paper' : 'text-coal/70 hover:text-coal') : active ? 'text-accent-hi' : 'text-faint hover:text-soft'}`}
          >
            {/* The current choice: a soft vermilion pill with vermilion text (a coal pill on the vermilion band). */}
            {active && <motion.span layoutId={id} className={`absolute inset-0 rounded-full ${onAccent ? 'bg-coal' : 'bg-accent/[0.14] ring-1 ring-accent/35 ring-inset'}`} transition={SLIDE} />}
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
              active ? 'border-accent/40 bg-accent/[0.14] text-accent-hi' : 'border-line bg-surface text-soft hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
