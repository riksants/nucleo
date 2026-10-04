import { motion } from 'framer-motion'
import { useState } from 'react'
import { optionOf, TASK_PRIORITY } from '../../data/labels'
import { useStore } from '../../data/store'
import type { Task } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { DueLabel } from '../projects/ProjectCard'
import { useNames } from '../shared/useNames'

const PRIORITY_DOT = { none: '', low: 'bg-soft', medium: 'bg-warn', high: 'bg-expense' }

function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <motion.span
      className="grid size-7 place-items-center rounded-full border-2"
      initial={false}
      animate={{
        backgroundColor: checked ? 'var(--color-accent)' : 'rgba(0,0,0,0)',
        borderColor: checked ? 'var(--color-accent)' : 'rgba(255,255,255,0.22)',
        scale: checked ? [1, 1.15, 1] : 1,
      }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="white" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.28, delay: checked ? 0.08 : 0 }} />
      </svg>
    </motion.span>
  )
}

export function TaskRow({ task, onOpen, showProject = true }: { task: Task; onOpen(t: Task): void; showProject?: boolean }) {
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
      exit={{ opacity: 0, height: 0, transition: { duration: 0.22 } }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-1 rounded-2xl px-1 hover:bg-white/[0.03] tap">
        <button type="button" onClick={toggle} aria-label={done ? 'Marcar como não feita' : 'Concluir tarefa'} className="grid size-12 shrink-0 place-items-center">
          <CheckCircle checked={checked} />
        </button>
        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 py-3 pr-2 text-left">
          <span className="flex items-center gap-2">
            {task.priority !== 'none' && <span className={`size-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} aria-label={`Prioridade ${optionOf(TASK_PRIORITY, task.priority).label}`} />}
            <span className={`relative truncate text-[15.5px] transition-colors duration-300 ${checked ? 'text-faint' : ''}`}>
              {task.title}
              <motion.span
                className="absolute top-1/2 left-0 h-px bg-current"
                initial={false}
                animate={{ width: checked ? '100%' : '0%' }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            {task.status === 'doing' && <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11.5px] font-medium text-accent-hi">Fazendo</span>}
          </span>
          {(project || (task.dueDate && !done) || task.changedBy) && (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-faint">
              {project && <span className="truncate">{project}</span>}
              {task.changedBy === 'assistant' && <span className="text-accent-hi/80">Alterado pelo Assistente</span>}
              {task.dueDate && !done && <DueLabel date={task.dueDate} />}
              {task.dueDate && task.dueTime && !done && <span className="num">{task.dueTime}</span>}
            </span>
          )}
        </button>
      </div>
    </motion.div>
  )
}
