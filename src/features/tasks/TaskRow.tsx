import { motion } from 'framer-motion'
import { CalendarClock, Flag } from 'lucide-react'
import { useState } from 'react'
import { optionOf, TASK_PRIORITY } from '../../data/labels'
import { useStore } from '../../data/store'
import type { Task } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { DueLabel } from '../projects/ProjectCard'
import { useNames } from '../shared/useNames'
import { EASE_OUT_SOFT } from '../../lib/motion'

// Priority is said in words (with a flag), never by color alone; the color only reinforces it.
const PRIORITY_TEXT = { none: '', low: 'text-faint', medium: 'text-accent-hi', high: 'font-semibold text-expense' }

function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <motion.span
      className="grid size-7 place-items-center rounded-full border-2"
      initial={false}
      animate={{
        backgroundColor: checked ? 'var(--color-accent)' : 'rgba(0,0,0,0)',
        borderColor: checked ? 'var(--color-accent)' : 'var(--color-check-line)',
        scale: checked ? [1, 1.1, 1] : 1,
      }}
      transition={{ duration: 0.2, ease: EASE_OUT_SOFT }}
    >
      <svg viewBox="0 0 24 24" className="size-4 stroke-on-accent" fill="none" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.16, delay: checked ? 0.04 : 0 }} />
      </svg>
    </motion.span>
  )
}

const NEXT_PRIORITY: Record<Task['priority'], Task['priority']> = { none: 'low', low: 'medium', medium: 'high', high: 'none' }

/**
 * `onPostpone`: shows a "move" button (Tarefas, Hoje) for tasks due today or late.
 * `emphasis`: a vermilion edge on high-priority tasks (lists sorted by relevance).
 * `priorityTap`: the flag changes the priority in one tap (none → baixa → média → alta → none).
 * `selecting`: the circle selects the task (several at once) instead of completing it.
 */
export function TaskRow({
  task,
  onOpen,
  showProject = true,
  onPostpone,
  emphasis,
  priorityTap,
  selecting,
  selected,
  onSelect,
}: {
  task: Task
  onOpen(t: Task): void
  showProject?: boolean
  onPostpone?(t: Task): void
  emphasis?: boolean
  priorityTap?: boolean
  selecting?: boolean
  selected?: boolean
  onSelect?(t: Task): void
}) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const names = useNames()
  const [checking, setChecking] = useState(false)
  const done = task.status === 'done'
  const checked = done !== checking
  const project = showProject ? names.project(task.projectId) : undefined

  const toggle = () => {
    if (checking) return
    setChecking(true)
    // Let the check animation play before the row moves to the other list.
    window.setTimeout(async () => {
      await save('tasks', { ...task, status: done ? 'todo' : 'done', completedAt: done ? null : new Date().toISOString() })
      setChecking(false)
      if (!done) toast('Tarefa concluída')
    }, 520)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2, ease: EASE_OUT_SOFT } }}
      transition={{ duration: 0.2, ease: EASE_OUT_SOFT }}
      className="overflow-hidden"
    >
      <div className="relative flex items-center gap-1 rounded-2xl px-1 hover:bg-tint/[0.03] tap">
        {emphasis && task.priority === 'high' && !done && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-expense" />}
        {selecting ? (
          <button type="button" role="checkbox" aria-checked={!!selected} onClick={() => onSelect?.(task)} aria-label={`Selecionar ${task.title}`} className="grid size-12 shrink-0 place-items-center">
            <span className={`grid size-6 place-items-center rounded-lg border-2 ${selected ? 'border-accent bg-accent text-on-accent' : 'border-check-line'}`}>{selected && <span className="text-[13px] leading-none font-bold">✓</span>}</span>
          </button>
        ) : (
          <button type="button" onClick={toggle} aria-label={done ? 'Marcar como não feita' : 'Concluir tarefa'} className="grid size-12 shrink-0 place-items-center">
            <CheckCircle checked={checked} />
          </button>
        )}
        <button type="button" onClick={() => (selecting ? onSelect?.(task) : onOpen(task))} className="min-w-0 flex-1 py-3 pr-2 text-left">
          <span className="flex items-center gap-2">
            <span className={`relative truncate text-[15px] transition-colors duration-300 ${checked ? 'text-faint' : ''}`}>
              {task.title}
              <span
                className="absolute top-1/2 left-0 h-px w-full origin-left bg-current transition-transform duration-200 ease-(--ease-out-soft) motion-reduce:transition-none"
                style={{ transform: `scaleX(${checked ? 1 : 0})` }}
              />
            </span>
            {task.status === 'doing' && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-tint/[0.08] px-2 py-0.5 text-[12px] font-medium text-ink">
                <span aria-hidden className="pixel" />
                Fazendo
              </span>
            )}
          </span>
          {(project || (task.dueDate && !done) || task.changedBy || (task.priority !== 'none' && !done)) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-faint">
              {task.priority !== 'none' && !done && (
                <span className={`inline-flex items-center gap-1 ${PRIORITY_TEXT[task.priority]}`} data-priority={task.priority}>
                  <Flag size={14} strokeWidth={2.4} fill={task.priority === 'high' ? 'currentColor' : 'none'} aria-hidden />
                  <span className="sr-only">Prioridade </span>
                  {optionOf(TASK_PRIORITY, task.priority).label}
                </span>
              )}
              {project && <span className="truncate">{project}</span>}
              {task.changedBy === 'assistant' && <span className="text-soft">Alterado pelo Assistente</span>}
              {task.dueDate && !done && <DueLabel date={task.dueDate} />}
              {task.dueDate && task.dueTime && !done && <span className="num">{task.dueTime}</span>}
            </span>
          )}
        </button>
        {priorityTap && !done && !selecting && (
          <button
            type="button"
            onClick={() => {
              const next = NEXT_PRIORITY[task.priority]
              void save('tasks', { ...task, priority: next })
              toast(next === 'none' ? 'Sem prioridade' : `Prioridade ${optionOf(TASK_PRIORITY, next).label.toLowerCase()}`)
            }}
            aria-label={`Prioridade de ${task.title}: ${task.priority === 'none' ? 'nenhuma' : optionOf(TASK_PRIORITY, task.priority).label}. Tocar muda.`}
            className={`grid size-10 shrink-0 place-items-center rounded-xl hover:bg-tint/[0.05] ${task.priority === 'none' ? 'text-faint/60' : PRIORITY_TEXT[task.priority]}`}
          >
            <Flag size={18} fill={task.priority === 'high' ? 'currentColor' : 'none'} />
          </button>
        )}
        {onPostpone && !done && !selecting && (
          <button type="button" onClick={() => onPostpone(task)} aria-label={`Adiar ${task.title}`} title="Adiar" className="grid size-11 shrink-0 place-items-center rounded-xl text-faint hover:bg-tint/[0.05] hover:text-ink">
            <CalendarClock size={18} />
          </button>
        )}
      </div>
    </motion.div>
  )
}
