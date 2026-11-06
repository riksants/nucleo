import { type ReactNode, useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../lib/hooks'

/*
 * Shared motion pieces (techniques adapted from the reference prompts, without their decoration):
 * - card → detail: the tapped card's rectangle is remembered for a moment; the Sheet that opens right
 *   after grows out of it (FLIP + clip-path, WAAPI) and goes back into it when closed.
 * - rolling values: the old value leaves upward through a mask while the new one rises in.
 * - tab content: slides in from the side of the chosen option.
 */

/** Easing of the card → detail opening (slow start, long soft landing). */
export const EASE_EXPAND = 'cubic-bezier(0.76, 0, 0.18, 1)'

export interface ExpandOrigin {
  /** The tapped card (its box is read only when the detail lays out — nothing is measured at the tap). */
  el: Element
  at: number
}

let lastOrigin: ExpandOrigin | null = null

/**
 * Elements marked `data-expand` open a detail: on click, their box (or the closest `data-expand-box`)
 * is remembered. Capture phase, so it is recorded before React opens the Sheet. Any other click
 * forgets it.
 */
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target instanceof Element ? e.target.closest('[data-expand]') : null
      if (!target) {
        lastOrigin = null
        return
      }
      lastOrigin = { el: target.closest('[data-expand-box]') ?? target, at: performance.now() }
    },
    true,
  )
}

let lastEntrance = 0
/** A screen or a detail is opening now (its indicators may fill in from empty). */
export function markEntrance() {
  lastEntrance = performance.now()
}
/**
 * Indicators fill in from empty only as part of opening a screen/detail — not when they reappear on the
 * same screen (switching a filter, a list updating): then they just show their value.
 */
export function isEntering(): boolean {
  return performance.now() - lastEntrance < 700
}

/** The card the person just tapped (at most 600 ms ago). Read-only, so it is safe while rendering. */
export function peekExpandOrigin(): ExpandOrigin | null {
  return lastOrigin && lastOrigin.el.isConnected && performance.now() - lastOrigin.at < 600 ? lastOrigin : null
}

/**
 * A value (already formatted by the app) that rolls when it changes: the old one leaves upward through
 * a mask and the new one rises in. Nothing moves on the first render. Reduced motion: swaps instantly.
 */
export function Rolling({ value, className = '' }: { value: string; className?: string }) {
  const reduce = usePrefersReducedMotion()
  const seq = useRef(0)
  const [items, setItems] = useState<{ k: number; v: string; out?: boolean }[]>([{ k: 0, v: value }])
  const current = items[items.length - 1]

  useEffect(() => {
    if (value === current.v) return
    seq.current += 1
    const next = { k: seq.current, v: value }
    setItems(reduce ? [next] : [{ ...current, out: true }, next])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce])

  const settle = (k: number) => setItems((xs) => xs.filter((x) => !x.out || x.k !== k))
  // Safety net: a value that is off screen may never fire animationend.
  const leaving = items.find((x) => x.out)?.k
  useEffect(() => {
    if (leaving === undefined) return
    const t = setTimeout(() => settle(leaving), 900)
    return () => clearTimeout(t)
  }, [leaving])

  return (
    <span className={`roll ${className}`}>
      {items.map((it) => (
        <span
          key={it.k}
          aria-hidden={it.out || undefined}
          className={it.out ? 'roll-out' : items.length > 1 ? 'roll-in' : undefined}
          onAnimationEnd={it.out ? () => settle(it.k) : undefined}
        >
          {it.v}
        </span>
      ))}
    </span>
  )
}

/**
 * Content of a tab/selector: when the choice changes, the new content slides in from the side of the
 * chosen option (forward from the right, back from the left). `order` = the options in display order.
 */
export function SwapIn<V extends string>({ value, order, className = '', children }: { value: V; order: readonly V[]; className?: string; children: ReactNode }) {
  // Derived from the previous choice (React's "adjust state while rendering" pattern).
  const [seen, setSeen] = useState<{ v: V; dir: 'fwd' | 'back'; moved: boolean }>({ v: value, dir: 'fwd', moved: false })
  if (seen.v !== value) setSeen({ v: value, dir: order.indexOf(value) < order.indexOf(seen.v) ? 'back' : 'fwd', moved: true })
  return (
    <div key={value} className={`${seen.moved ? 'swap-in' : ''} ${className}`} data-dir={seen.dir}>
      {children}
    </div>
  )
}

/**
 * A section's content when it opens: fades in and rises 10px (CSS `.page-in`). The class goes away when
 * the entrance ends, so sections that appear later on the same page don't replay it.
 */
export function PageEnter({ children }: { children: ReactNode }) {
  const [entering, setEntering] = useState(() => {
    markEntrance()
    return true
  })
  return (
    <div className={entering ? 'page-in' : undefined} onAnimationEnd={(e) => e.animationName === 'page-rise' && setEntering(false)}>
      {children}
    </div>
  )
}
