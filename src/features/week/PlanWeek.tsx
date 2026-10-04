import { CalendarPlus, ListPlus, Star } from 'lucide-react'
import { useMemo } from 'react'
import { useDailyActions } from '../../core/actions'
import { buildAgenda } from '../../core/agenda'
import { weekMetrics } from '../../core/metrics'
import { weekDates } from '../../core/period'
import { sortOpenTasks } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Task, WeekId } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { AgendaRow } from '../agenda/AgendaRow'
import { EventForm } from '../agenda/EventForm'
import { useOpenItem } from '../agenda/openItem'
import { TaskForm } from '../tasks/TaskForm'
import { GoalsSection } from './GoalsSection'

const DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const SHORT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
const label = (d: string, f = DAY) => f.format(new Date(`${d}T12:00:00Z`)).replace('.', '')

/**
 * Prepare a week: everything already dated shows up by itself (agenda); moving a
 * task to a day changes that task's date; priorities are the task's own priority.
 */
export function PlanWeek({ week, currentWeek, today }: { week: WeekId; currentWeek: WeekId; today: string }) {
  const { data, settings, save } = useStore()
  const { moveTask } = useDailyActions()
  const { toast } = useFeedback()
  const days = weekDates(week)
  const items = useMemo(() => buildAgenda(data, settings, days[0], days[6]), [data, settings, days[0], days[6]])
  const metrics = useMemo(() => weekMetrics(data, settings, week), [data, settings, week])
  const newTask = useSheet<string>()
  const newEvent = useSheet<string>()
  const { open, sheets } = useOpenItem()
  // Tasks to place: no date yet, or overdue.
  const loose = sortOpenTasks(data.tasks.filter((t) => t.status !== 'done' && (!t.dueDate || t.dueDate < today))).slice(0, 15)

  const togglePriority = async (t: Task) => {
    await save('tasks', { ...t, priority: t.priority === 'high' ? 'none' : 'high' })
  }

  return (
    <div className="space-y-7">
      <GoalsSection week={week} currentWeek={currentWeek} metrics={metrics} />

      {loose.length > 0 && (
        <section>
          <SectionTitle>Para encaixar na semana</SectionTitle>
          <div className="card divide-y divide-line">
            {loose.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => togglePriority(t)} aria-label={t.priority === 'high' ? 'Tirar prioridade' : 'Marcar como prioridade'} className={`grid size-8 shrink-0 place-items-center rounded-lg ${t.priority === 'high' ? 'text-warn' : 'text-faint hover:text-soft'}`}>
                    <Star size={17} fill={t.priority === 'high' ? 'currentColor' : 'none'} />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{t.title}</span>
                  {t.dueDate && <span className="shrink-0 text-[13px] text-expense">atrasada</span>}
                </div>
                <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pl-10">
                  {days.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={async () => (await moveTask(t, d), toast(`“${t.title}” → ${label(d, SHORT)}`))}
                      className="press h-8 shrink-0 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-soft hover:text-ink"
                    >
                      {label(d, SHORT)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Dias da semana</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          {days.map((d) => {
            const list = items.filter((i) => i.date === d)
            return (
              <div key={d} className="card p-1.5">
                <div className="flex items-center gap-1 px-3 pt-2 pb-1">
                  <p className={`min-w-0 flex-1 text-[14px] font-medium first-letter:uppercase ${d === today ? 'text-accent-hi' : ''}`}>{label(d)}</p>
                  <button type="button" aria-label={`Nova tarefa em ${label(d)}`} title="Nova tarefa" onClick={() => newTask.show(d)} className="grid size-9 place-items-center rounded-xl text-faint hover:bg-white/[0.04] tap hover:text-ink">
                    <ListPlus size={17} />
                  </button>
                  <button type="button" aria-label={`Novo compromisso em ${label(d)}`} title="Novo compromisso" onClick={() => newEvent.show(d)} className="grid size-9 place-items-center rounded-xl text-faint hover:bg-white/[0.04] tap hover:text-ink">
                    <CalendarPlus size={17} />
                  </button>
                </div>
                {list.length ? list.map((i) => <AgendaRow key={i.key} item={i} onOpen={open} readOnly={d > today} />) : <p className="px-3.5 pb-3 text-[14px] text-faint">Livre</p>}
              </div>
            )
          })}
        </div>
      </section>

      <TaskForm open={newTask.open} onClose={newTask.close} task={null} initial={{ dueDate: newTask.item ?? '' }} />
      <EventForm open={newEvent.open} onClose={newEvent.close} event={null} initial={{ date: newEvent.item ?? '' }} />
      {sheets}
    </div>
  )
}
