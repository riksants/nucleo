import { AnimatePresence } from 'framer-motion'
import { CalendarCheck, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { emptyRoutineAnswers } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { isEnabled } from '../../app/modules'
import { navigate, type RoutePath } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { ACTIVE_PROJECT_STATUSES, isPaidTool, nextChargeDate, sortOpenTasks } from '../../data/selectors'
import { isOverdue, saleRemaining } from '../../data/sales'
import { useStore } from '../../data/store'
import { nextChargeOf } from '../../data/subscriptions'
import type { Task, Weekday } from '../../data/types'
import { daysBetween, formatDateValue, formatWeekday, fromDateInput, relativeDays, toDateInput } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { usePlans } from '../planner/plans'
import { DayAgenda } from '../planner/RoutinePage'
import { useBuyerName } from '../sales/SalesPage'
import { TaskForm } from '../tasks/TaskForm'
import { TaskRow } from '../tasks/TaskRow'

const UPCOMING_DAYS = 7

function Block({ title, action, onAction, children }: { title: string; action?: string; onAction?(): void; children: ReactNode }) {
  return (
    <section>
      <SectionTitle action={action} onAction={onAction}>
        {title}
      </SectionTitle>
      {children}
    </section>
  )
}

interface DueItem {
  key: string
  date: string
  title: string
  subtitle: string
  amount?: string
  tone: 'in' | 'out' | 'neutral'
  path: RoutePath
  open: string
}

/**
 * Everything for today, read from the original records (no copies): completing
 * a task here completes the task itself; routine checks update the saved plan.
 */
export function TodayPage() {
  const { data, settings } = useStore()
  const { routine, meals, profile } = usePlans()
  const buyer = useBuyerName()
  const taskSheet = useSheet<Task>()
  const now = new Date()
  const today = toDateInput(now)
  const weekday = now.getDay() as Weekday
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)

  const open = data.tasks.filter((t) => t.status !== 'done')
  const todayTasks = sortOpenTasks(open.filter((t) => t.dueDate === today)).sort((a, b) => (a.dueTime && b.dueTime ? toMinutes(a.dueTime) - toMinutes(b.dueTime) : a.dueTime ? -1 : b.dueTime ? 1 : 0))
  const overdue = sortOpenTasks(open.filter((t) => t.dueDate && t.dueDate < today))
  const appointments = open
    .filter((t) => t.dueTime && t.dueDate > today && daysBetween(now, fromDateInput(t.dueDate)!) <= UPCOMING_DAYS)
    .sort((a, b) => (a.dueDate + a.dueTime < b.dueDate + b.dueTime ? -1 : 1))

  const todayMeals = meals ? meals.meals.filter((m) => m.day === weekday).sort((a, b) => toMinutes(a.time) - toMinutes(b.time)) : []

  const due: DueItem[] = []
  const within = (date: string) => {
    const d = fromDateInput(date)
    return d !== null && daysBetween(now, d) <= UPCOMING_DAYS
  }
  if (on('projects')) {
    for (const p of data.projects) if (p.dueDate && ACTIVE_PROJECT_STATUSES.has(p.status) && within(p.dueDate)) due.push({ key: `p${p.id}`, date: p.dueDate, title: p.name, subtitle: 'Prazo do projeto', tone: 'neutral', path: '/projects', open: p.id })
  }
  if (on('sales')) {
    for (const s of data.sales) {
      const rest = saleRemaining(s)
      if (s.dueDate && rest > 0 && (within(s.dueDate) || isOverdue(s))) due.push({ key: `s${s.id}`, date: s.dueDate, title: buyer(s), subtitle: `Receber · ${s.product}`, amount: formatMoney(rest, s.currency), tone: 'in', path: '/sales', open: s.id })
    }
  }
  if (on('subscribers')) {
    const plans = new Map(data.subPlans.map((p) => [p.id, p]))
    for (const s of data.subscribers) {
      const plan = plans.get(s.planId)
      const date = s.status === 'active' ? nextChargeOf(s, plan, now) : ''
      if (date && plan && within(date)) due.push({ key: `u${s.id}`, date, title: s.name, subtitle: `Cobrança · ${plan.name}`, amount: formatMoney(plan.price, plan.currency), tone: 'in', path: '/subscribers', open: s.id })
    }
  }
  if (on('tools')) {
    for (const t of data.tools) {
      if (!isPaidTool(t) || t.status !== 'active' || !t.nextCharge) continue
      const date = nextChargeDate(t, now)
      if (within(date)) due.push({ key: `t${t.id}`, date, title: t.name, subtitle: 'Você paga', amount: formatMoney(t.price, t.currency), tone: 'out', path: '/tools', open: t.id })
    }
  }
  due.sort((a, b) => (a.date < b.date ? -1 : 1))

  const routineToday = routine?.blocks.some((b) => b.day === weekday)
  const nothing = !todayTasks.length && !overdue.length && !appointments.length && !routineToday && !todayMeals.length && !due.length

  return (
    <>
      <PageHeader title="Hoje" subtitle={<span className="first-letter:uppercase">{formatWeekday(now)}, {new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(now)}</span>} />
      {nothing && (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent/12 text-accent-hi">
            <CalendarCheck size={22} />
          </div>
          <p className="text-[17px] font-semibold tracking-tight">Dia livre</p>
          <p className="mt-1.5 max-w-72 text-[15px] leading-relaxed text-soft">Nenhuma tarefa, horário, refeição ou prazo para hoje.</p>
        </div>
      )}
      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <div className="space-y-7">
          {on('tasks') && overdue.length > 0 && (
            <Block title={`Atrasadas · ${overdue.length}`}>
              <div className="card border-expense/20 p-1.5">
                <AnimatePresence initial={false}>
                  {overdue.map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={taskSheet.show} />
                  ))}
                </AnimatePresence>
              </div>
            </Block>
          )}
          {on('tasks') && (todayTasks.length > 0 || !nothing) && (
            <Block title="Tarefas de hoje" action="Nova" onAction={() => taskSheet.show()}>
              {todayTasks.length ? (
                <div className="card p-1.5">
                  <AnimatePresence initial={false}>
                    {todayTasks.map((t) => (
                      <TaskRow key={t.id} task={t} onOpen={taskSheet.show} />
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <p className="card px-5 py-4 text-[15px] text-faint">Nada com prazo para hoje.</p>
              )}
            </Block>
          )}
          {on('tasks') && appointments.length > 0 && (
            <Block title="Próximos compromissos">
              <div className="card p-1.5">
                {appointments.map((t) => (
                  <button key={t.id} type="button" onClick={() => taskSheet.show(t)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left hover:bg-white/[0.03]">
                    <span className="num w-24 shrink-0 text-[14px] text-soft">
                      {formatDateValue(t.dueDate)} {t.dueTime}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{t.title}</span>
                  </button>
                ))}
              </div>
            </Block>
          )}
          {on('routine') && routine && routineToday && (
            <Block title="Rotina de hoje" action="Semana" onAction={() => navigate('/routine')}>
              <DayAgenda plan={routine} day={weekday} editable={false} answers={profile?.routine ?? { ...emptyRoutineAnswers(), wakeWeekday: '00:00', sleepWeekday: '00:00', wakeWeekend: '00:00', sleepWeekend: '00:00' }} onEdit={() => navigate('/routine')} />
            </Block>
          )}
        </div>
        <div className="space-y-7">
          {on('meals') && todayMeals.length > 0 && (
            <Block title="Refeições de hoje" action="Plano" onAction={() => navigate('/meals')}>
              <div className="card divide-y divide-line">
                {todayMeals.map((m) => (
                  <div key={m.id} className="flex gap-3 px-4 py-3">
                    <span className="num w-12 shrink-0 pt-0.5 text-[14px] text-soft">{m.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{m.label}</span>
                      {m.items.length > 0 && <span className="block text-[13px] leading-relaxed text-faint">{m.items.join(' · ')}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Block>
          )}
          {due.length > 0 && (
            <Block title="Prazos, pagamentos e cobranças">
              <div className="card p-1.5">
                {due.map((d) => {
                  const rel = relativeDays(d.date)
                  return (
                    <button key={d.key} type="button" onClick={() => navigate(d.path, { open: d.open })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left hover:bg-white/[0.03]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{d.title}</span>
                        <span className={`text-[13px] ${rel && rel.days < 0 ? 'text-expense' : rel && rel.days <= 1 ? 'text-warn' : 'text-faint'}`}>
                          {d.subtitle} · {rel?.label}
                        </span>
                      </span>
                      {d.amount && <span className={`num shrink-0 text-[15px] font-semibold ${d.tone === 'in' ? 'text-income' : ''}`}>{d.amount}</span>}
                      <ChevronRight size={16} className="shrink-0 text-faint" />
                    </button>
                  )
                })}
              </div>
            </Block>
          )}
        </div>
      </div>
      <TaskForm open={taskSheet.open} onClose={taskSheet.close} task={taskSheet.item} />
    </>
  )
}
