import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsDesktop, useKeyboardInset, useScrollLock } from '../lib/hooks'
import { IconButton } from './Button'

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

const SPRING = { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 } as const

/** Bottom sheet on phones, centered dialog on desktop. */
export function Sheet({ open, onClose, title, actions, footer, children, size = 'md' }: SheetProps) {
  const desktop = useIsDesktop()
  const keyboard = useKeyboardInset(open && !desktop)
  const drag = useDragControls()
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose()
  }

  const width = size === 'lg' ? 'lg:max-w-2xl' : 'lg:max-w-lg'

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-6" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className={`relative flex w-full flex-col border border-line bg-surface shadow-2xl shadow-black/60 max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] rounded-t-[1.75rem] lg:max-h-[86dvh] lg:rounded-[1.75rem] ${width}`}
            style={{ marginBottom: keyboard }}
            initial={desktop ? { opacity: 0, scale: 0.97, y: 8 } : { y: '100%' }}
            animate={desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={desktop ? { opacity: 0, scale: 0.98, y: 4 } : { y: '100%' }}
            transition={desktop ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] } : SPRING}
            drag={desktop ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragListener={false}
            dragControls={drag}
            onDragEnd={onDragEnd}
          >
            <header
              className="shrink-0 touch-none px-5 pb-2 lg:touch-auto lg:px-6 lg:pt-5"
              onPointerDown={(e) => !desktop && drag.start(e)}
            >
              {!desktop && <div className="mx-auto mt-2.5 mb-3 h-1.5 w-10 rounded-full bg-white/15" aria-hidden />}
              <div className="flex items-center gap-3">
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h2>
                {actions}
                <IconButton label="Fechar" size="sm" onClick={onClose}>
                  <X size={20} />
                </IconButton>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 lg:px-6">
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
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
