import { AnimatePresence } from 'framer-motion'
import { ArrowUp, ListTodo } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { PageHeader } from '../../app/Shell'
import { useStore } from '../../data/store'
import { sortOpenTasks } from '../../data/selectors'
import type { Task, TaskStatus } from '../../data/types'
import { usePref } from '../../lib/prefs'
import { IconButton } from '../../ui/Button'
import { EmptyState } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { TaskForm } from './TaskForm'
import { TaskRow } from './TaskRow'

export function TasksPage() {
  const { data, save } = useStore()
  const { toast } = useFeedback()
  const [tab, setTab] = usePref<TaskStatus>('tasks.tab', 'todo')
  const [quick, setQuick] = useState('')
  const adding = useRef(false)
  const form = useSheet<Task>()
  useOpenParam(data.tasks, form.show)

  const count = (s: TaskStatus) => data.tasks.filter((t) => t.status === s).length
  const list =
    tab === 'done'
      ? data.tasks.filter((t) => t.status === 'done').sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))
      : sortOpenTasks(data.tasks.filter((t) => t.status === tab))

  const quickAdd = async (e: FormEvent) => {
    e.preventDefault()
    const title = quick.trim()
    // A second Enter while the first is saving must not create the same task twice.
    if (!title || adding.current) return
    adding.current = true
    try {
      await save('tasks', { title, projectId: null, dueDate: '', priority: 'none', status: tab === 'done' ? 'todo' : tab, completedAt: null })
      setQuick('')
      toast('Tarefa criada')
    } finally {
      adding.current = false
    }
  }

  return (
    <>
      <PageHeader
        title="Tarefas"
        primary={{ label: 'Nova', aria: 'Nova tarefa', onPress: () => form.show() }}
      />

      <form onSubmit={quickAdd} className="mb-4 flex gap-2">
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Adicionar tarefa rápida…"
          enterKeyHint="done"
          className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-ink placeholder:text-faint focus:border-accent-hi/60 focus:outline-none"
        />
        <IconButton label="Adicionar" tone="accent" type="submit" className="size-12! rounded-2xl" disabled={!quick.trim()}>
          <ArrowUp size={20} strokeWidth={2.4} />
        </IconButton>
      </form>

      <div className="mb-4">
        <Segmented variant="underline"
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

      {list.length ? (
        <div className="card p-1.5">
          <AnimatePresence initial={false}>
            {list.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={form.show} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <EmptyState
          compact
          icon={<ListTodo size={20} />}
          title={tab === 'done' ? 'Nenhuma tarefa concluída' : data.tasks.length ? 'Tudo em dia' : 'Nenhuma tarefa ainda'}
          text={tab === 'done' ? undefined : 'Use o campo acima para anotar uma tarefa em segundos.'}
          action={tab === 'done' ? undefined : 'Adicionar tarefa'}
          onAction={() => form.show()}
        />
      )}

      <TaskForm open={form.open} onClose={form.close} task={form.item} />
    </>
  )
}
