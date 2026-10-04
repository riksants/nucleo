import { animate, motion, useMotionValue } from 'framer-motion'
import { usePrefersReducedMotion } from '../lib/hooks'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TONE_BADGE, type Tone } from '../data/labels'
import type { Cents, Currency } from '../data/types'
import { formatMoney } from '../lib/money'
import { Button } from './Button'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap ${TONE_BADGE[tone]}`}>
      {children}
    </span>
  )
}

/**
 * Progress bar. It shows the value right away (data being read shouldn't move on every visit) and only
 * animates when the value changes: 300 ms, revealed with clip-path (no layout work, rounded tip kept).
 */
export function Progress({ value, tone = 'goal' }: { value: number; tone?: 'goal' | 'accent' | 'positive' }) {
  const color = { goal: 'bg-goal', accent: 'bg-accent', positive: 'bg-income' }[tone]
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={`h-full w-full rounded-full transition-[clip-path] duration-300 ease-(--ease-out-soft) motion-reduce:transition-none ${color}`}
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0 round 999px)` }}
      />
    </div>
  )
}

/** Money value that counts smoothly from its previous value to the new one. */
export function AnimatedMoney({ cents, currency, className }: { cents: Cents; currency: Currency; className?: string }) {
  const reduce = usePrefersReducedMotion()
  const mv = useMotionValue(cents)
  const [shown, setShown] = useState(cents)
  const first = useRef(true)

  useEffect(() => {
    if (first.current || reduce) {
      first.current = false
      mv.set(cents)
      setShown(cents)
      return
    }
    const controls = animate(mv, cents, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    })
    return () => controls.stop()
  }, [cents, mv, reduce])

  return <span className={className}>{formatMoney(shown, currency)}</span>
}

export function EmptyState({
  icon,
  title,
  text,
  action,
  onAction,
  compact,
}: {
  icon: ReactNode
  title: string
  text?: string
  action?: string
  onAction?(): void
  compact?: boolean
}) {
  const reduce = usePrefersReducedMotion()
  return (
    <motion.div
      initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`card flex flex-col items-center border-dashed text-center ${compact ? 'px-5 py-7' : 'px-6 py-12'}`}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent/12 text-accent-hi">{icon}</div>
      <p className="text-[17px] font-semibold tracking-tight">{title}</p>
      {text && <p className="mt-1.5 max-w-72 text-[15px] leading-relaxed text-soft">{text}</p>}
      {action && onAction && (
        <Button className="mt-5" onClick={onAction}>
          {action}
        </Button>
      )}
    </motion.div>
  )
}

export function SearchField({ value, onChange, placeholder = 'Buscar', autoFocus }: { value: string; onChange(v: string): void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="search"
        className="h-12 w-full rounded-2xl border border-line bg-surface pr-10 pl-10 text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Limpar busca" onClick={() => onChange('')} className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-faint hover:text-ink">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

/** Small uppercase label + optional right-side link, above a group of content. */
export function SectionTitle({ children, action, onAction }: { children: ReactNode; action?: string; onAction?(): void }) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-medium tracking-wide text-soft uppercase">{children}</h2>
      {action && (
        <button type="button" onClick={onAction} className="hit relative text-sm font-medium text-accent-hi hover:text-ink">
          {action}
        </button>
      )}
    </div>
  )
}

/** A label/value line used inside detail sheets. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3.5 last:border-0">
      <span className="shrink-0 text-[15px] text-soft">{label}</span>
      <span className="min-w-0 text-right text-[15px] break-words">{children}</span>
    </div>
  )
}
