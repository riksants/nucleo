import { AnimatePresence, motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../lib/hooks'
import { AlertCircle, Check } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { EASE_OUT_SOFT } from '../lib/motion'

type ToastTone = 'success' | 'error'

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}

/** A short follow-up offered with a toast ("Marcar também"). */
export interface ToastAction {
  label: string
  run(): void
}

interface FeedbackApi {
  toast(message: string, tone?: ToastTone, action?: ToastAction): void
  confirm(options: ConfirmOptions): Promise<boolean>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone; action?: ToastAction } | null>(null)
  const timer = useRef<number>(0)
  const [pending, setPending] = useState<(ConfirmOptions & { resolve(ok: boolean): void }) | null>(null)
  const reduceMotion = usePrefersReducedMotion()

  const showToast = useCallback((message: string, tone: ToastTone = 'success', action?: ToastAction) => {
    window.clearTimeout(timer.current)
    setToast({ id: Date.now(), message, tone, action })
    // With an action the person needs time to read and tap it.
    timer.current = window.setTimeout(() => setToast(null), action ? 6000 : 2200)
  }, [])

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  )

  const settle = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  const api = useMemo<FeedbackApi>(() => ({ toast: showToast, confirm }), [showToast, confirm])

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(8px,env(safe-area-inset-bottom))+84px)] z-[70] flex justify-center px-4 lg:bottom-8 lg:pl-64">
          <AnimatePresence mode="popLayout">
            {toast && (
              <motion.div
                key={toast.id}
                role="status"
                initial={{ opacity: 0, transform: reduceMotion ? 'none' : 'translateY(14px) scale(0.96)' }}
                animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
                // Leaves faster than it came (the system answering, not the person deciding), the same way down.
                exit={{ opacity: 0, transform: reduceMotion ? 'none' : 'translateY(10px) scale(0.98)', transition: { duration: 0.15, ease: EASE_OUT_SOFT } }}
                transition={{ duration: 0.22, ease: EASE_OUT_SOFT }}
                className={`flex items-center gap-2.5 rounded-full border border-line-strong bg-elevated/95 py-2.5 pl-3 text-[15px] font-medium shadow-xl shadow-shade/50 backdrop-blur-md reduce-transparency:bg-elevated reduce-transparency:backdrop-blur-none ${toast.action ? 'pointer-events-auto pr-2.5' : 'pr-5'}`}
              >
                <span className={`grid size-6 place-items-center rounded-full ${toast.tone === 'success' ? 'bg-accent text-on-accent' : 'bg-expense/20 text-expense'}`}>
                  {toast.tone === 'success' ? <Check size={14} strokeWidth={2.6} /> : <AlertCircle size={16} />}
                </span>
                {toast.message}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action!.run()
                      setToast(null)
                    }}
                    className="press -my-1 ml-1 h-8 shrink-0 rounded-full bg-accent px-3 text-[14px] font-semibold text-on-accent"
                  >
                    {toast.action.label}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
      <Sheet
        open={pending !== null}
        onClose={() => settle(false)}
        title={pending?.title}
        footer={
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" size="lg" onClick={() => settle(false)}>
              Cancelar
            </Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} size="lg" onClick={() => settle(true)}>
              {pending?.confirmLabel ?? 'Confirmar'}
            </Button>
          </div>
        }
      >
        {pending?.message && <p className="pt-1 text-[15px] leading-relaxed text-soft">{pending.message}</p>}
      </Sheet>
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext)
  if (!api) throw new Error('useFeedback must be used inside FeedbackProvider')
  return api
}
