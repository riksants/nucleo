import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, CalendarDays, CheckSquare, Clock, Flag, ListTodo, Repeat, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { PageHeader } from '../../app/Shell'
import { addDaysToDate, todayIn, zoneOf } from '../../core/period'
import { parseQuickTask } from '../../core/quickParse'
import { answerCapture, parseCapture } from '../../core/capture'
import { describeRule } from '../../core/recurrence'
import { isEnabled } from '../../app/modules'
import { Button } from '../../ui/Button'
import { Chips } from '../../ui/Segmented'
import { RecurringForm } from '../recurring/RecurringForm'
import { useNames } from '../shared/useNames'
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
  const { data, save, remove, settings } = useStore()
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
  const names = useNames()
  // Filters: priority, deadline, project (only the ones that have something).
  const [filter, setFilter] = usePref<string>('tasks.filter', 'all')
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [recurring, setRecurring] = useState<{ title: string; rule: NonNullable<ReturnType<typeof parseCapture>['rule']>; time: string } | null>(null)
  const pass = (t: Task) =>
    filter === 'all' ? true : filter === 'high' ? t.priority === 'high' : filter === 'dated' ? !!t.dueDate : filter === 'undated' ? !t.dueDate : filter.startsWith('p:') ? t.projectId === filter.slice(2) : true
  const pool = data.tasks.filter(pass)
  const groups = tab === 'done' ? doneGroups(pool.filter((t) => t.status === 'done'), today) : openGroups(pool.filter((t) => t.status === tab), today)
  const projectsWithTasks = [...new Set(open.map((t) => t.projectId).filter(Boolean) as string[])].slice(0, 4)
  const filters = [
    { value: 'all', label: 'Todas' },
    ...(open.some((t) => t.priority === 'high') ? [{ value: 'high', label: 'Alta prioridade' }] : []),
    { value: 'dated', label: 'Com prazo' },
    { value: 'undated', label: 'Sem prazo' },
    ...projectsWithTasks.map((id) => ({ value: `p:${id}`, label: names.project(id) ?? 'Projeto' })),
  ]

  // What the quick field understood ("sexta às 15h", "urgente", "toda segunda"): shown before saving.
  const [hour, setHour] = useState<string | null>(null)
  const priority = quick.trim() ? parseQuickTask(quick, today).priority : 'none'
  const captured = quick.trim() ? parseCapture(quick.replace(/(^|\s)(!{1,3}|urgente)(?=\s|$)/gi, ' '), today) : null
  const resolved = captured && hour ? answerCapture(captured, { time: hour }) : captured
  const parsed = resolved ? { title: resolved.title || quick.trim(), dueDate: resolved.date ?? (resolved.time ? today : ''), dueTime: resolved.time ?? '', priority } : null
  const understood = parsed && (parsed.dueDate || parsed.dueTime || parsed.priority !== 'none') ? parsed : null
  const repeats = resolved?.rule && isEnabled(settings, 'recurring') ? resolved.rule : null
  const quickAdd = async (e?: FormEvent) => {
    e?.preventDefault()
    // A second Enter while the first is saving must not create the same task twice.
    if (!parsed || adding.current) return
    // "toda segunda": a task doesn't repeat — it becomes a recurring item, checked in its form.
    if (repeats) return setRecurring({ title: parsed.title, rule: repeats, time: parsed.dueTime })
    // An hour that could be morning or afternoon is asked first.
    if (resolved?.timeOptions) return toast('Escolha o horário abaixo', 'error')
    adding.current = true
    try {
      await save('tasks', { title: parsed.title, projectId: filter.startsWith('p:') ? filter.slice(2) : null, dueDate: parsed.dueDate, dueTime: parsed.dueTime, priority: parsed.priority, status: tab === 'done' ? 'todo' : tab, completedAt: null })
      setQuick('')
      setHour(null)
      toast(parsed.dueDate ? `Tarefa criada para ${parsed.dueDate === today ? 'hoje' : formatDateValue(parsed.dueDate)}` : 'Tarefa criada')
    } finally {
      adding.current = false
    }
  }

  // Several at once, always undoable: the previous versions are kept until the toast goes away.
  const chosen = data.tasks.filter((t) => picked.has(t.id))
  const bulk = async (kind: 'done' | 'tomorrow' | 'delete') => {
    const before = chosen.map((t) => ({ ...t }))
    if (!before.length) return
    if (kind === 'delete') for (const t of before) await remove('tasks', t.id)
    else for (const t of before) await save('tasks', kind === 'done' ? { ...t, status: 'done', completedAt: t.completedAt ?? new Date().toISOString() } : { ...t, dueDate: addDaysToDate(today, 1) })
    setPicked(new Set())
    setSelecting(false)
    const n = before.length
    toast(kind === 'delete' ? `${n} ${n === 1 ? 'tarefa excluída' : 'tarefas excluídas'}` : kind === 'done' ? `${n} ${n === 1 ? 'tarefa concluída' : 'tarefas concluídas'}` : `${n} para amanhã`, 'success', {
      label: 'Desfazer',
      run: () => void Promise.all(before.map((t) => save('tasks', t))),
    })
  }
  const toggleSelect = (t: Task) => setPicked((p) => {
    const next = new Set(p)
    if (next.has(t.id)) next.delete(t.id)
    else next.add(t.id)
    return next
  })

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
            onChange={(e) => (setQuick(e.target.value), setHour(null))}
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
          {resolved?.timeOptions && (
            <p className="flex flex-wrap items-center gap-1.5 px-1 pt-1 text-[13px] text-soft">
              Qual horário?
              {resolved.timeOptions.map((t) => (
                <button key={t} type="button" onClick={() => setHour(t)} className="press h-7 rounded-full border border-line bg-surface px-2.5 text-[13px] font-medium">
                  {t}
                </button>
              ))}
            </p>
          )}
          {repeats && (
            <p className="flex flex-wrap items-center gap-1.5 px-1 pt-1 text-[13px] text-soft">
              <Repeat size={14} className="text-accent-hi" /> Repete ({describeRule(repeats).toLowerCase()}): Enter cria como <span className="font-medium text-ink">Recorrente</span>, para conferir.
            </p>
          )}
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

      <div className="mb-3">
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
      </div>
      <div className="mb-5 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Chips value={filters.some((f) => f.value === filter) ? filter : 'all'} onChange={setFilter} options={filters} />
        </div>
        {tab !== 'done' && groups.length > 0 && (
          <button type="button" aria-pressed={selecting} aria-label={selecting ? 'Cancelar seleção' : 'Selecionar'} title={selecting ? 'Cancelar seleção' : 'Selecionar várias'} onClick={() => (setSelecting(!selecting), setPicked(new Set()))} className={`press grid size-9 shrink-0 place-items-center rounded-full ${selecting ? 'bg-ink text-bg' : 'text-soft ring-1 ring-line ring-inset hover:text-ink'}`}>
            {selecting ? <X size={16} /> : <CheckSquare size={16} />}
          </button>
        )}
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
                    <TaskRow key={t.id} task={t} onOpen={form.show} emphasis onPostpone={g.tone ? setPostponing : undefined} priorityTap={tab !== 'done'} selecting={selecting} selected={picked.has(t.id)} onSelect={toggleSelect} />
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

      {selecting && picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(max(8px,env(safe-area-inset-bottom))+84px)] z-[60] flex justify-center px-4 lg:bottom-8 lg:pl-64">
          <div className="flex items-center gap-1.5 rounded-full border border-line-strong bg-elevated/95 p-1.5 shadow-xl shadow-shade/50 backdrop-blur-md">
            <span className="px-2.5 text-[14px] font-semibold">{picked.size}</span>
            <Button className="h-10! px-4!" onClick={() => bulk('done')}>
              Concluir
            </Button>
            <Button variant="secondary" className="h-10! px-3.5!" onClick={() => bulk('tomorrow')}>
              Amanhã
            </Button>
            <Button variant="danger" className="h-10! px-3.5!" onClick={() => bulk('delete')}>
              Excluir
            </Button>
          </div>
        </div>
      )}

      <TaskForm open={form.open} onClose={form.close} task={form.item} />
      <RecurringForm
        open={!!recurring}
        onClose={() => setRecurring(null)}
        item={null}
        initial={recurring ? { title: recurring.title, rule: recurring.rule, time: recurring.time } : undefined}
        onSaved={() => (setQuick(''), setRecurring(null))}
      />
      <PostponeSheet task={postponing} onClose={() => setPostponing(null)} />
    </>
  )
}
