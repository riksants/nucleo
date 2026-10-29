import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, CalendarDays, Clock, Flag, ListTodo } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { PageHeader } from '../../app/Shell'
import { addDaysToDate, todayIn, zoneOf } from '../../core/period'
import { parseQuickTask } from '../../core/quickParse'
import { useStore } from '../../data/store'
import { sortOpenTasks } from '../../data/selectors'
import type { Task, TaskStatus } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { EASE_OUT_SOFT } from '../../lib/motion'
import { usePref } from '../../lib/prefs'
import { IconButton } from '../../ui/Button'
import { EmptyState, Progress } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { PostponeSheet } from './PostponeSheet'
import { TaskForm } from './TaskForm'
import { TaskRow } from './TaskRow'

interface Group {
  id: string
  title: string
  tone?: 'late' | 'today'
  tasks: Task[]
}

/** Open tasks by when they are due, most urgent first (inside each group: priority, then date). */
function openGroups(tasks: Task[], today: string): Group[] {
  const tomorrow = addDaysToDate(today, 1)
  const week = addDaysToDate(today, 7)
  const sorted = sortOpenTasks(tasks)
  const groups: Group[] = [
    { id: 'late', title: 'Atrasadas', tone: 'late', tasks: sorted.filter((t) => t.dueDate && t.dueDate < today) },
    { id: 'today', title: 'Hoje', tone: 'today', tasks: sorted.filter((t) => t.dueDate === today) },
    { id: 'tomorrow', title: 'Amanhã', tasks: sorted.filter((t) => t.dueDate === tomorrow) },
    { id: 'week', title: 'Próximos 7 dias', tasks: sorted.filter((t) => t.dueDate > tomorrow && t.dueDate <= week) },
    { id: 'later', title: 'Mais tarde', tasks: sorted.filter((t) => t.dueDate > week) },
    { id: 'none', title: 'Sem prazo', tasks: sorted.filter((t) => !t.dueDate) },
  ]
  return groups.filter((g) => g.tasks.length)
}

function doneGroups(tasks: Task[], today: string): Group[] {
  const day = (t: Task) => (t.completedAt ?? '').slice(0, 10)
  const weekAgo = addDaysToDate(today, -7)
  const sorted = [...tasks].sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))
  return [
    { id: 'd-today', title: 'Concluídas hoje', tasks: sorted.filter((t) => day(t) === today) },
    { id: 'd-week', title: 'Nesta semana', tasks: sorted.filter((t) => day(t) < today && day(t) >= weekAgo) },
    { id: 'd-before', title: 'Antes', tasks: sorted.filter((t) => day(t) < weekAgo) },
  ].filter((g) => g.tasks.length)
}

export function TasksPage() {
  const { data, save, settings } = useStore()
  const { toast } = useFeedback()
  const reduce = usePrefersReducedMotion()
  const [tab, setTab] = usePref<TaskStatus>('tasks.tab', 'todo')
  const [quick, setQuick] = useState('')
  const adding = useRef(false)
  const form = useSheet<Task>()
  const [postponing, setPostponing] = useState<Task | null>(null)
  useOpenParam(data.tasks, form.show)
  const today = todayIn(zoneOf(settings))

  const count = (s: TaskStatus) => data.tasks.filter((t) => t.status === s).length
  const open = data.tasks.filter((t) => t.status !== 'done')
  const late = open.filter((t) => t.dueDate && t.dueDate < today).length
  const dueToday = open.filter((t) => t.dueDate === today).length
  const doneToday = data.tasks.filter((t) => t.status === 'done' && (t.completedAt ?? '').slice(0, 10) === today).length
  // Today's progress: what was due today (or done today) and is done.
  const todayTotal = dueToday + doneToday
  const groups = tab === 'done' ? doneGroups(data.tasks.filter((t) => t.status === 'done'), today) : openGroups(data.tasks.filter((t) => t.status === tab), today)

  // What the quick field understood so far ("amanhã às 10h", "urgente"): shown before saving.
  const parsed = quick.trim() ? parseQuickTask(quick, today) : null
  const understood = parsed && (parsed.dueDate || parsed.priority !== 'none') ? parsed : null

  const quickAdd = async (e: FormEvent) => {
    e.preventDefault()
    // A second Enter while the first is saving must not create the same task twice.
    if (!parsed || adding.current) return
    adding.current = true
    try {
      await save('tasks', { title: parsed.title, projectId: null, dueDate: parsed.dueDate, dueTime: parsed.dueTime, priority: parsed.priority, status: tab === 'done' ? 'todo' : tab, completedAt: null })
      setQuick('')
      toast(parsed.dueDate ? `Tarefa criada para ${parsed.dueDate === today ? 'hoje' : formatDateValue(parsed.dueDate)}` : 'Tarefa criada')
    } finally {
      adding.current = false
    }
  }

  return (
    <>
      <PageHeader
        rich
        icon={ListTodo}
        eyebrow={`${open.length} em aberto`}
        title="Tarefas"
        primary={{ label: 'Nova', aria: 'Nova tarefa', onPress: () => form.show() }}
        stats={[
          { label: 'Atrasadas', value: late },
          { label: 'Para hoje', value: dueToday },
          { label: 'Feitas hoje', value: doneToday },
        ]}
      />

      <form onSubmit={quickAdd} className="mb-2">
        <div className="flex gap-2">
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Nova tarefa… ex.: ligar pro banco amanhã 10h"
            aria-label="Adicionar tarefa rápida"
            enterKeyHint="done"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-ink placeholder:text-faint focus:border-accent-hi/60 focus:outline-none"
          />
          <IconButton label="Adicionar" tone="accent" type="submit" className="size-12! rounded-2xl" disabled={!quick.trim()}>
            <ArrowUp size={20} strokeWidth={2.4} />
          </IconButton>
        </div>
        <div className="min-h-7 pt-1.5" aria-live="polite">
          <AnimatePresence initial={false}>
            {understood && (
              <motion.p
                initial={reduce ? false : { opacity: 0, transform: 'translateY(-3px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE_OUT_SOFT }}
                className="flex flex-wrap items-center gap-1.5 px-1 text-[13px] text-soft"
              >
                <span className="font-medium text-ink">“{understood.title}”</span>
                {understood.dueDate && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/[0.12] px-2 py-0.5 font-medium text-accent-hi">
                    <CalendarDays size={14} /> {understood.dueDate === today ? 'Hoje' : formatDateValue(understood.dueDate)}
                  </span>
                )}
                {understood.dueTime && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/[0.12] px-2 py-0.5 font-medium text-accent-hi">
                    <Clock size={14} /> {understood.dueTime}
                  </span>
                )}
                {understood.priority === 'high' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-expense/[0.12] px-2 py-0.5 font-medium text-expense">
                    <Flag size={14} /> Alta
                  </span>
                )}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </form>

      {todayTotal > 0 && tab !== 'done' && (
        <div className="mb-5 flex items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <Progress value={(doneToday / todayTotal) * 100} tone="accent" />
          </div>
          <span className="num shrink-0 text-[13px] font-medium text-soft">
            Hoje {doneToday} de {todayTotal}
          </span>
        </div>
      )}

      <div className="mb-5">
        <Segmented
          variant="underline"
          block
          label="Estado"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'todo', label: `A fazer · ${count('todo')}` },
            { value: 'doing', label: `Fazendo · ${count('doing')}` },
            { value: 'done', label: `Feito · ${count('done')}` },
          ]}
        />
        <p className="mt-2 px-1 text-[13px] text-faint">
          {tab === 'todo' ? 'Ainda não começadas, das mais urgentes para as sem prazo.' : tab === 'doing' ? 'Em andamento: o que você já começou.' : 'Concluídas, das mais recentes.'}
        </p>
      </div>

      {groups.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2 lg:items-start">
          {groups.map((g) => (
            <section key={g.id} aria-label={g.title}>
              <h2 className={`mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold ${g.tone === 'late' ? 'text-expense' : g.tone === 'today' ? 'text-accent-hi' : 'text-soft'}`}>
                {g.title}
                <span className="text-faint">{g.tasks.length}</span>
              </h2>
              <div className={`card p-1.5 ${g.tone === 'late' ? 'border-expense/25' : ''}`}>
                <AnimatePresence initial={false}>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={form.show} emphasis onPostpone={g.tone ? setPostponing : undefined} />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          icon={<ListTodo size={20} />}
          title={tab === 'done' ? 'Nenhuma tarefa concluída' : tab === 'doing' ? 'Nada em andamento' : data.tasks.length ? 'Tudo em dia' : 'Nenhuma tarefa ainda'}
          text={tab === 'done' ? 'O que você concluir aparece aqui.' : tab === 'doing' ? 'Abra uma tarefa e mude o estado para “Fazendo” quando começar.' : 'Escreva no campo acima: “amanhã”, “sexta” ou “10h” já viram data e hora.'}
          action={tab === 'done' ? undefined : 'Adicionar tarefa'}
          onAction={() => form.show()}
        />
      )}

      <TaskForm open={form.open} onClose={form.close} task={form.item} />
      <PostponeSheet task={postponing} onClose={() => setPostponing(null)} />
    </>
  )
}
