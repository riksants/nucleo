import { animate, AnimatePresence, motion, type MotionProps } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsDesktop, usePrefersReducedMotion, useScrollLock, useVisualViewport } from '../lib/hooks'
import { IconButton } from './Button'
import { EASE_OUT_SOFT } from '../lib/motion'
import { EASE_EXPAND, type ExpandOrigin, markEntrance, peekExpandOrigin } from './Motion'

interface SheetProps {
  open: boolean
  onClose(): void
  title?: ReactNode
  /** Right side of the header (e.g. an edit button). */
  actions?: ReactNode
  /** Sticky area under the scrollable body, for the main action. */
  footer?: ReactNode
  children: ReactNode
  size?: 'md' | 'lg'
}

/** Critically damped (no overshoot), settles in ~0.27 s. */
const SPRING = { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 } as const
const FULL_CLIP = 'inset(0px 0px 0px 0px round 0px)'
/** Close on a drag past this distance… */
const DISMISS_DISTANCE = 110
/** …or on a downward flick faster than this (px/ms), even if short. */
const DISMISS_VELOCITY = 0.11

/** Past the top the sheet resists more the further it goes, instead of a hard stop (Apple's rubber band). */
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/**
 * Drag to dismiss on phones: from the header, or from the content while it is scrolled to the top
 * (otherwise the content scrolls as usual). The panel follows the finger 1:1; on release it closes on
 * distance or a flick, or springs back.
 */
function useDragToDismiss(open: boolean, enabled: boolean, onClose: () => void, reduce: boolean) {
  const panel = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const el = panel.current
    if (!open || !enabled || !el) return
    let startY = 0
    let fromHeader = false
    let state: 'idle' | 'dragging' | 'native' = 'idle'
    let offset = 0
    let samples: { y: number; t: number }[] = []
    const set = (y: number) => {
      offset = y
      el.style.transform = y ? `translateY(${y}px)` : ''
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startY = e.touches[0].clientY
      fromHeader = !!header.current?.contains(e.target as Node)
      state = 'idle'
      samples = [{ y: startY, t: e.timeStamp }]
    }
    const onMove = (e: TouchEvent) => {
      if (state === 'native' || e.touches.length !== 1) return
      const y = e.touches[0].clientY
      const dy = y - startY
      if (state === 'idle') {
        if (Math.abs(dy) < 6) return
        const atTop = (scroller.current?.scrollTop ?? 0) <= 0
        state = fromHeader || (dy > 0 && atTop) ? 'dragging' : 'native'
        if (state === 'native') return
      }
      e.preventDefault()
      set(dy >= 0 ? dy : rubberband(dy, el.offsetHeight))
      samples.push({ y, t: e.timeStamp })
      if (samples.length > 6) samples.shift()
    }
    const onEnd = () => {
      if (state !== 'dragging') return
      state = 'idle'
      const first = samples[0]
      const last = samples[samples.length - 1]
      const velocity = last && first && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0
      if (offset > DISMISS_DISTANCE || (velocity > DISMISS_VELOCITY && offset > 12)) {
        closeRef.current()
        return
      }
      if (reduce) set(0)
      else
        void animate(el, { transform: 'translateY(0px)' }, SPRING).then(() => {
          offset = 0
          el.style.transform = ''
        })
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [open, enabled, reduce])

  return { panel, header, scroller }
}

/** Bottom sheet on phones, centered dialog on desktop. */
export function Sheet({ open, onClose, title, actions, footer, children, size = 'md' }: SheetProps) {
  const desktop = useIsDesktop()
  // Phones: the sheet lives inside the visible part of the screen (above the keyboard on iPhone).
  const vv = useVisualViewport(open && !desktop)
  const keyboard = Boolean(vv?.keyboard)
  const reduce = usePrefersReducedMotion()
  const { panel, header, scroller } = useDragToDismiss(open, !desktop, onClose, reduce)
  useScrollLock(open)

  // The field being typed in stays in view by scrolling the sheet's own content — never the page.
  // A money field brings its calculator keys and result along.
  useEffect(() => {
    const box = scroller.current
    if (!open || !box) return
    const reveal = () => {
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || !box.contains(el) || !el.matches('input, textarea, select')) return
      const target = (el.closest('[data-amount-field]') as HTMLElement | null) ?? el
      const r = target.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      if (r.bottom > b.bottom - 12) box.scrollTop += r.bottom - b.bottom + 12
      else if (r.top < b.top + 8) box.scrollTop -= b.top + 8 - r.top
    }
    const later = () => requestAnimationFrame(reveal)
    box.addEventListener('focusin', later)
    later()
    return () => box.removeEventListener('focusin', later)
  }, [open, vv?.height, scroller])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Opened by tapping a card (Projetos, Metas, Clientes): the sheet grows out of that card — it starts
  // exactly over the card (FLIP: moved there, clipped to its size) and opens to its place; closing goes
  // back into the card. Decided when it opens (React's "adjust state while rendering" pattern).
  const [opening, setOpening] = useState<{ open: boolean; origin: ExpandOrigin | null }>({ open: false, origin: null })
  const [fromCard, setFromCard] = useState<{ transform: string; clipPath: string } | null>(null)
  if (opening.open !== open) {
    setOpening({ open, origin: open ? (reduce ? null : peekExpandOrigin()) : opening.origin })
    if (open) {
      setFromCard(null)
      markEntrance()
    }
  }
  const origin = opening.origin
  const shell = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = shell.current
    if (!open || !origin || !el || !origin.el.isConnected) return
    // one layout read for both boxes (the sheet's layout is needed for its first frame anyway)
    const box = el.getBoundingClientRect()
    const r = origin.el.getBoundingClientRect()
    const radius = parseFloat(getComputedStyle(origin.el).borderTopLeftRadius) || 16
    const from = {
      transform: `translateY(${Math.round(r.top - box.top)}px)`,
      clipPath: `inset(0px ${Math.max(0, Math.round(box.right - r.right))}px ${Math.max(0, Math.round(box.height - r.height))}px ${Math.max(0, Math.round(r.left - box.left))}px round ${radius}px)`,
    }
    // WAAPI, compositor-friendly (transform + clip-path), like the reference's detail opening.
    const anim = el.animate([from, { transform: 'translateY(0px)', clipPath: FULL_CLIP }], { duration: 560, easing: EASE_EXPAND })
    // The way back into the card is only needed to close: kept once the opening ends, so the sheet isn't
    // rendered a second time on its first frame. Closed before that, it simply fades out.
    let live = true
    anim.finished.then(() => live && setFromCard(from)).catch(() => {})
    return () => {
      live = false
    }
  }, [open, origin])

  const width = size === 'lg' ? 'lg:max-w-2xl' : 'lg:max-w-lg'
  // Full transform strings run on the GPU (WAAPI). "Reduzir movimento": fade only, no slide.
  const motionProps: MotionProps = origin
    ? {
        initial: { transform: 'translateY(0px)', clipPath: FULL_CLIP },
        animate: { transform: 'translateY(0px)', clipPath: FULL_CLIP },
        exit: fromCard ? { ...fromCard, transition: { duration: 0.42, ease: [0.5, 0, 0.2, 1] } } : { opacity: 0, transition: { duration: 0.2 } },
      }
    : reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2 } }
    : desktop
      ? {
          initial: { opacity: 0, transform: 'translateY(8px) scale(0.97)' },
          animate: { opacity: 1, transform: 'translateY(0px) scale(1)' },
          exit: { opacity: 0, transform: 'translateY(4px) scale(0.98)' },
          transition: { duration: 0.18, ease: EASE_OUT_SOFT },
        }
      : { initial: { transform: 'translateY(100%)' }, animate: { transform: 'translateY(0%)' }, exit: { transform: 'translateY(100%)' }, transition: SPRING }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-6" role="dialog" aria-modal="true" style={vv ? { top: vv.top, height: vv.height, bottom: 'auto' } : undefined}>
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          {/* Outer layer: enter/exit. Inner layer: follows the finger while dragging. */}
          <motion.div ref={shell} className={`relative w-full ${width}`} {...motionProps}>
            <div
              ref={panel}
              style={vv ? { maxHeight: `calc(${vv.height}px - env(safe-area-inset-top) - 8px)` } : undefined}
              className={`flex w-full flex-col border border-line-strong bg-sheet shadow-[0_24px_48px_-16px_var(--color-shade)] max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] rounded-t-[1.5rem] lg:max-h-[86dvh] lg:rounded-[1.5rem]${origin ? ' sheet-reveal' : ''}`}
            >
              <header ref={header} className="shrink-0 touch-none px-5 pb-2 lg:touch-auto lg:px-6 lg:pt-5">
                {!desktop && <div className="mx-auto mt-2.5 mb-3 h-1.5 w-10 rounded-full bg-tint/15" aria-hidden />}
                <div className="flex items-center gap-3">
                  <h2 className="min-w-0 flex-1 overflow-hidden text-lg font-semibold tracking-tight">
                    <span data-sheet-title className="block truncate">
                      {title}
                    </span>
                  </h2>
                  {actions}
                  <IconButton label="Fechar" size="sm" tone="raised" onClick={onClose}>
                    <X size={20} />
                  </IconButton>
                </div>
              </header>
              <div ref={scroller} data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 lg:px-6">
                {children}
              </div>
              {footer && (
                <div
                  className="shrink-0 border-t border-line px-5 pt-3 lg:px-6 lg:pb-5"
                  style={{ paddingBottom: keyboard ? 12 : 'max(16px, env(safe-area-inset-bottom))' }}
                >
                  {footer}
                </div>
              )}
              {!footer && <div className="shrink-0 pb-safe" />}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
