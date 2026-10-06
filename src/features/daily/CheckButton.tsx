import { motion } from 'framer-motion'
import { Minus } from 'lucide-react'
import type { OccurrenceStatus } from '../../core/completions'

/** Same circle as tasks, plus a neutral "skipped" state (never shown as done). */
export function CheckButton({ status, onClick, label }: { status: OccurrenceStatus; onClick(): void; label: string }) {
  const done = status === 'done'
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={done} className="grid size-12 shrink-0 place-items-center">
      <motion.span
        className="grid size-7 place-items-center rounded-full border-2"
        initial={false}
        animate={{
          backgroundColor: done ? 'var(--color-accent)' : 'rgba(0,0,0,0)',
          borderColor: done ? 'var(--color-accent)' : status === 'skipped' ? 'var(--color-check-line-soft)' : 'var(--color-check-line)',
          scale: done ? [1, 1.1, 1] : 1,
        }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {status === 'skipped' ? (
          <Minus size={14} className="text-faint" strokeWidth={3} />
        ) : (
          <svg viewBox="0 0 24 24" className="size-4 stroke-on-accent" fill="none" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }} transition={{ duration: 0.16, delay: done ? 0.04 : 0 }} />
          </svg>
        )}
      </motion.span>
    </button>
  )
}
