import { AnimatePresence } from 'framer-motion'
import { CalendarCheck, Check, ChevronRight, MessageCircle } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { emptyRoutineAnswers } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { isEnabled } from '../../app/modules'
import { navigate, useRoute, type RoutePath } from '../../app/router'
import { planDay } from '../../core/day'
import { addDaysToDate, nowIn, useToday, weekdayOfDate, zoneOf } from '../../core/period'
import { Segmented } from '../../ui/Segmented'
import { PageHeader } from '../../app/Shell'
import { ACTIVE_PROJECT_STATUSES, isPaidTool, nextChargeDate, sortOpenTasks } from '../../data/selectors'
import { isOverdue, saleRemaining } from '../../data/sales'
import { useStore } from '../../data/store'
import { nextChargeOf } from '../../data/subscriptions'
import type { Task, Weekday } from '../../data/types'
import { daysBetween, formatDateValue, fromDateInput, relativeDays } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { Celebrate } from '../../ui/Celebrate'
import { SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { usePlans } from '../planner/plans'
import { DayAgenda } from '../planner/RoutinePage'
import { useBuyerName } from '../sales/useBuyerName'
import { TaskForm } from '../tasks/TaskForm'

/** Up to 3 suggestions; its code loads after the screen (startup stays light). */
const AttentionCard = lazy(() => import('../assistant/Insights').then((m) => ({ default: m.AttentionCard })))
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
/** The original "Hoje" screen, unchanged except that the day follows the chosen time zone. */
function DayView({ today }: { today: string }) {
  const { data, settings } = useStore()
  const { routine, meals, profile } = usePlans()
  const buyer = useBuyerName()
  const taskSheet = useSheet<Task>()
  const now = new Date()
  const weekday = weekdayOfDate(today) as Weekday
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)

  const open = data.tasks.filter((t) => t.status !== 'done')
  const todayTasks = sortOpenTasks(open.filter((t) => t.dueDate === today)).sort((a, b) => (a.dueTime && b.dueTime ? toMinutes(a.dueTime) - toMinutes(b.dueTime) : a.dueTime ? -1 : b.dueTime ? 1 : 0))
  const overdue = sortOpenTasks(open.filter((t) => t.dueDate && t.dueDate < today))
  // The last task of the day was just done here (not on load): keep the block and celebrate it.
  const [prevCount, setPrevCount] = useState(todayTasks.length)
  const [cleared, setCleared] = useState(false)
  if (prevCount !== todayTasks.length) {
    setPrevCount(todayTasks.length)
    setCleared(todayTasks.length === 0 && prevCount > 0)
  }
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
          {on('tasks') && (todayTasks.length > 0 || !nothing || cleared) && (
            <Block title="Tarefas de hoje" action="Nova" onAction={() => taskSheet.show()}>
              {todayTasks.length ? (
                <div className="card p-1.5">
                  <AnimatePresence initial={false}>
                    {todayTasks.map((t) => (
                      <TaskRow key={t.id} task={t} onOpen={taskSheet.show} />
                    ))}
                  </AnimatePresence>
                </div>
              ) : cleared ? (
                <p className="card flex items-center gap-3 px-5 py-4 text-[15px] font-medium">
                  <Celebrate active onMount>
                    <span className="grid size-7 place-items-center rounded-full bg-income/15 text-income">
                      <Check size={16} strokeWidth={2.6} />
                    </span>
                  </Celebrate>
                  Tudo feito por hoje
                </p>
              ) : (
                <p className="card px-5 py-4 text-[15px] text-faint">Nada com prazo para hoje.</p>
              )}
            </Block>
          )}
          {on('tasks') && appointments.length > 0 && (
            <Block title="Próximos compromissos">
              <div className="card p-1.5">
                {appointments.map((t) => (
                  <button key={t.id} type="button" onClick={() => taskSheet.show(t)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left hover:bg-tint/[0.03] tap">
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
                    <button key={d.key} type="button" onClick={() => navigate(d.path, { open: d.open })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left hover:bg-tint/[0.03] tap">
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

const MorningView = lazy(() => import('./MorningView').then((m) => ({ default: m.MorningView })))
const NightView = lazy(() => import('./NightView').then((m) => ({ default: m.NightView })))

export type DayMode = 'morning' | 'day' | 'night'

function greeting(hour: number) {
  return hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
}

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** "Hoje" hub: Manhã · Dia · Noite. "Dia" is the original screen and stays the default. */
export function TodayPage() {
  const { data, settings } = useStore()
  const { params } = useRoute()
  const tz = zoneOf(settings)
  const today = useToday(tz)
  const hour = nowIn(tz).hour
  const asked = params.get('mode')
  const [mode, setMode] = useState<DayMode>(asked === 'morning' || asked === 'night' ? asked : 'day')
  useEffect(() => {
    if (asked === 'morning' || asked === 'night' || asked === 'day') setMode(asked)
  }, [asked])
  const plan = useMemo(() => (mode === 'day' ? null : planDay(data, settings, new Date(), today)), [mode, data, settings, today])
  const tomorrowPlan = useMemo(() => (mode === 'night' ? planDay(data, settings, new Date(), addDaysToDate(today, 1)) : null), [mode, data, settings, today])
  const hint = mode === 'day' ? (hour < 12 ? { to: 'morning' as const, label: 'Começar o dia' } : hour >= 18 ? { to: 'night' as const, label: 'Fechar o dia' } : null) : null

  return (
    <>
      <PageHeader
        title="Hoje"
        subtitle={<span className="first-letter:uppercase">{LONG_DATE.format(new Date(`${today}T12:00:00Z`))}</span>}
        actions={
          <button type="button" onClick={() => navigate('/assistant')} className="press flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[14px] font-medium text-soft hover:text-ink">
            <MessageCircle size={16} className="text-accent-hi" /> Assistente
          </button>
        }
      />
      <Suspense fallback={null}>
        <AttentionCard />
      </Suspense>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented<DayMode> label="Modo do dia" value={mode} onChange={setMode} options={[{ value: 'morning', label: 'Manhã' }, { value: 'day', label: 'Dia' }, { value: 'night', label: 'Noite' }]} />
        {hint && (
          <button type="button" onClick={() => setMode(hint.to)} className="hit relative flex items-center gap-1 text-[14px] font-medium text-accent-hi hover:text-ink">
            {hint.label} <ChevronRight size={16} />
          </button>
        )}
      </div>
      <Suspense fallback={null}>
        {mode === 'day' && <DayView today={today} />}
        {mode === 'morning' && plan && <MorningView plan={plan} greeting={greeting(hour)} />}
        {mode === 'night' && plan && tomorrowPlan && <NightView plan={plan} tomorrowPlan={tomorrowPlan} />}
      </Suspense>
    </>
  )
}
