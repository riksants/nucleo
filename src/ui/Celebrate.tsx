import { motion } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '../lib/hooks'

const EASE_OUT = [0.23, 1, 0.32, 1] as const

/**
 * A small, one-off celebration for rare moments (a goal reached, a debt settled, the day's tasks done):
 * the seal settles from 96% to full size while a soft ring glows out — 400 ms, once.
 * It plays when `active` turns true while on screen (or on mount with `onMount`), never on every visit.
 * "Reduzir movimento": no motion — the seal's own color change is the feedback.
 */
export function Celebrate({ active, onMount = false, children }: { active: boolean; onMount?: boolean; children: ReactNode }) {
  const reduce = usePrefersReducedMotion()
  const [prev, setPrev] = useState(active)
  const [burst, setBurst] = useState(onMount && active ? 1 : 0)
  if (prev !== active) {
    setPrev(active)
    if (active) setBurst((n) => n + 1)
  }
  if (!burst || !active || reduce) return <span className="relative inline-flex">{children}</span>
  return (
    <span className="relative inline-flex">
      <motion.span key={burst} className="inline-flex" initial={{ transform: 'scale(0.96)' }} animate={{ transform: 'scale(1)' }} transition={{ duration: 0.4, ease: EASE_OUT }}>
        {children}
      </motion.span>
      <motion.span
        key={`ring-${burst}`}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-income/60"
        initial={{ opacity: 0.8, transform: 'scale(1)' }}
        animate={{ opacity: 0, transform: 'scale(1.35)' }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
      />
    </span>
  )
}
