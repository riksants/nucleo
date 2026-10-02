import { CalendarArrowUp, CalendarX2, ChevronRight, MoonStar, SkipForward } from 'lucide-react'
import { isEnabled } from '../../app/modules'
import { navigate } from '../../app/router'
import { useStore } from '../../data/store'
import { useState, type ReactNode } from 'react'
import { useDailyActions } from '../../core/actions'
import type { AgendaItem } from '../../core/agenda'
import { mealsNightLine, nightSentence, type DayPlan } from '../../core/day'
import { addDaysToDate, weekdayOfDate } from '../../core/period'
import type { Task } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { Button } from '../../ui/Button'
import { SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, TextInput } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'
import { AgendaRow, useToggleItem } from '../agenda/AgendaRow'
import { useOpenItem } from '../agenda/openItem'

function Chip({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="press inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-soft hover:text-ink">
      {icon}
      {children}
    </button>
  )
}

/** A pending item with the quick actions that make sense for its type. */
function PendingRow({ item, tomorrow, onOpen, onReschedule }: { item: AgendaItem; tomorrow: string; onOpen(i: AgendaItem): void; onReschedule(t: Task): void }) {
  const toggle = useToggleItem()
  const { moveTask, clearTaskDate } = useDailyActions()
  const { toast } = useFeedback()
  const task = item.source.kind === 'task' ? item.source.task : null
  return (
    <div className="border-b border-line pb-2 last:border-0">
      <AgendaRow item={item} onOpen={onOpen} />
      <div className="flex flex-wrap gap-2 pb-1 pl-[56px]">
        {task ? (
          <>
            <Chip icon={<CalendarArrowUp size={14} />} onClick={async () => (await moveTask(task, tomorrow), toast('Mantida para amanhã'))}>
              Amanhã
            </Chip>
            <Chip icon={<CalendarArrowUp size={14} />} onClick={() => onReschedule(task)}>
              Reagendar
            </Chip>
            <Chip icon={<CalendarX2 size={14} />} onClick={async () => (await clearTaskDate(task), toast('Tirada da data — continua em Tarefas'))}>
              Tirar da data
            </Chip>
          </>
        ) : (
          item.status === 'pending' && (
            <Chip icon={<SkipForward size={14} />} onClick={() => toggle(item, 'skipped')}>
              Pular hoje
            </Chip>
          )
        )}
      </div>
    </div>
  )
}

function RescheduleSheet({ task, onClose, min }: { task: Task | null; onClose(): void; min: string }) {
  const { moveTask } = useDailyActions()
  const { toast } = useFeedback()
  const [date, setDate] = useState('')
  const save = async () => {
    if (!task || !date) return
    await moveTask(task, date)
    toast(`Reagendada para ${formatDateValue(date).toLowerCase()}`)
    setDate('')
    onClose()
  }
  return (
    <Sheet
      open={task !== null}
      onClose={onClose}
      title="Reagendar"
      footer={
        <Button size="lg" block disabled={!date} onClick={save}>
          Salvar nova data
        </Button>
      }
    >
      <p className="pb-4 text-[15px] text-soft">{task?.title}</p>
      <Field label="Nova data">
        <TextInput type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Sheet>
  )
}

/** Close the day: what got done, what stays, and a look at tomorrow. No judgment. */
export function NightView({ plan, tomorrowPlan }: { plan: DayPlan; tomorrowPlan: DayPlan }) {
  const { settings } = useStore()
  const weekday = weekdayOfDate(plan.date)
  const { open, sheets } = useOpenItem()
  const [rescheduling, setRescheduling] = useState<Task | null>(null)
  const [showDone, setShowDone] = useState(false)
  const tomorrow = addDaysToDate(plan.date, 1)
  const pending = plan.items.filter((i) => i.checkable && i.status === 'pending')
  const done = plan.items.filter((i) => i.checkable && i.status === 'done')
  const skipped = plan.items.filter((i) => i.checkable && i.status === 'skipped')
  const overdue = plan.overdue.map((task) => ({ key: `task:${task.id}`, kind: 'task', date: task.dueDate, start: task.dueTime ?? '', end: '', title: task.title, status: 'pending', checkable: true, source: { kind: 'task', task } }) as AgendaItem)
  const next = [...tomorrowPlan.events, ...tomorrowPlan.timed, ...tomorrowPlan.priorities.map((t) => ({ key: `p:${t.id}`, kind: 'task', date: tomorrow, start: t.dueTime ?? '', end: '', title: t.title, status: 'pending', checkable: true, source: { kind: 'task', task: t } }) as AgendaItem)]
    .filter((i, idx, all) => all.findIndex((x) => x.title === i.title && x.start === i.start) === idx)
    .sort((a, b) => (a.start || '99').localeCompare(b.start || '99'))
    .slice(0, 5)

  return (
    <div className="space-y-7">
      <div className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_80%_at_100%_0%,rgb(179_145_255/0.14),transparent_60%)]" aria-hidden />
        <p className="relative flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <MoonStar size={20} className="text-goal" /> Fechando o dia
        </p>
        <p className="relative mt-1 text-[16px] leading-relaxed text-soft">{nightSentence(plan)}</p>
        {plan.counts.habits > 0 && (
          <p className="relative mt-1 text-[14px] text-faint">
            Hábitos: {plan.counts.habitsDone} de {plan.counts.habits}
            {skipped.length ? ` · ${skipped.length} pulado${skipped.length > 1 ? 's' : ''}` : ''}
          </p>
        )}
        {mealsNightLine(plan) && <p className="relative mt-1 text-[14px] text-faint">{mealsNightLine(plan)}</p>}
      </div>

      {pending.length > 0 && (
        <section>
          <SectionTitle>Ficou para depois · {pending.length}</SectionTitle>
          <div className="card p-1.5">
            {pending.map((i) => (
              <PendingRow key={i.key} item={i} tomorrow={tomorrow} onOpen={open} onReschedule={setRescheduling} />
            ))}
          </div>
        </section>
      )}

      {overdue.length > 0 && (
        <section>
          <SectionTitle>De outros dias · {overdue.length}</SectionTitle>
          <div className="card p-1.5">
            {overdue.slice(0, 5).map((i) => (
              <PendingRow key={i.key} item={i} tomorrow={tomorrow} onOpen={open} onReschedule={setRescheduling} />
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section>
          <SectionTitle action={done.length > 4 ? (showDone ? 'Menos' : `Ver todos`) : undefined} onAction={() => setShowDone(!showDone)}>
            Concluído hoje · {done.length}
          </SectionTitle>
          <div className="card p-1.5">
            {(showDone ? done : done.slice(0, 4)).map((i) => (
              <AgendaRow key={i.key} item={i} onOpen={open} />
            ))}
          </div>
        </section>
      )}

      {plan.events.length > 0 && (
        <section>
          <SectionTitle>Compromissos de hoje</SectionTitle>
          <div className="card p-1.5">
            {plan.events.map((i) => (
              <AgendaRow key={i.key} item={i} onOpen={open} />
            ))}
          </div>
        </section>
      )}

      {weekday === 0 && isEnabled(settings, 'week') && (
        <button type="button" onClick={() => navigate('/week', { view: 'plan' })} className="card flex w-full items-center gap-3 border-accent/30 p-4 text-left hover:border-accent/50">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Quer preparar sua próxima semana?</span>
            <span className="text-[13px] text-faint">Opcional — tarefas, compromissos e metas.</span>
          </span>
          <ChevronRight size={18} className="text-faint" />
        </button>
      )}

      <section>
        <SectionTitle>Amanhã</SectionTitle>
        {next.length ? (
          <div className="card p-1.5">
            {next.map((i) => (
              <AgendaRow key={i.key} item={i} onOpen={open} readOnly />
            ))}
          </div>
        ) : (
          <p className="card px-5 py-4 text-[15px] text-faint">Nada marcado para amanhã ainda.</p>
        )}
      </section>

      <RescheduleSheet task={rescheduling} onClose={() => setRescheduling(null)} min={tomorrow} />
      {sheets}
    </div>
  )
}
