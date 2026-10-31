import { AnimatePresence } from 'framer-motion'
import { CalendarCheck, Check, ChevronLeft, ChevronRight, MessageCircle, Moon, Sunrise } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isEnabled } from '../../app/modules'
import { clearParams, navigate, useRoute, type RoutePath } from '../../app/router'
import { buildAgenda, tally, type AgendaItem } from '../../core/agenda'
import { planDay } from '../../core/day'
import { addDaysToDate, nowIn, useToday, zoneOf } from '../../core/period'
import { dayWords } from '../../core/capture'
import { nextUp, timeState } from '../../core/timeState'
import { PageHeader } from '../../app/Shell'
import { ACTIVE_PROJECT_STATUSES, isPaidTool, nextChargeDate, sortOpenTasks } from '../../data/selectors'
import { isOverdue, saleRemaining } from '../../data/sales'
import { useStore } from '../../data/store'
import { nextChargeOf } from '../../data/subscriptions'
import type { Task } from '../../data/types'
import { daysBetween, fromDateInput, relativeDays } from '../../lib/dates'
import { useNow } from '../../lib/hooks'
import { formatMoney } from '../../lib/money'
import { Celebrate } from '../../ui/Celebrate'
import { SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { useOpenItem } from '../agenda/openItem'
import { dotOf } from '../agenda/AgendaRow'
import { CreateSheet } from '../daily/CreateSheet'
import { DayTimeline } from '../daily/DayParts'
import { useBuyerName } from '../sales/useBuyerName'
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
 * Everything for today, read from the original records (no copies): what is happening now, what ended and needs a
 * yes/no, the day as a timeline (tasks, appointments, routine, habits, recurring, meals), late tasks and money due.
 * Marking here marks the record itself; the clock alone never marks anything as done.
 */
function DayView({ today, items, nowTime, onCreate }: { today: string; items: AgendaItem[]; nowTime: string; onCreate(): void }) {
  const { data, settings } = useStore()
  const buyer = useBuyerName()
  const taskSheet = useSheet<Task>()
  const { open: openItem, sheets } = useOpenItem()
  const now = new Date()
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)

  const open = data.tasks.filter((t) => t.status !== 'done')
  const overdue = sortOpenTasks(open.filter((t) => t.dueDate && t.dueDate < today))
  // The last thing of the day was just marked here (not on load): celebrate it.
  const left = items.filter((i) => (i.checkable || i.markable) && i.status === 'pending').length
  const [prevLeft, setPrevLeft] = useState(left)
  const [cleared, setCleared] = useState(false)
  if (prevLeft !== left) {
    setPrevLeft(left)
    setCleared(left === 0 && prevLeft > 0)
  }
  // Next days: appointments and tasks with a time (from the same agenda, so nothing shows twice).
  const appointments = useMemo(
    () => buildAgenda(data, settings, addDaysToDate(today, 1), addDaysToDate(today, UPCOMING_DAYS), now).filter((i) => i.start && (i.kind === 'event' || i.kind === 'task') && i.status !== 'done').slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, settings, today],
  )

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

  const nothing = !items.length && !overdue.length && !appointments.length && !due.length

  return (
    <>
      {nothing && (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-2xl icon-tile">
            <CalendarCheck size={24} />
          </div>
          <p className="text-[17px] font-semibold tracking-tight">Dia livre</p>
          <p className="mt-1.5 max-w-72 text-[15px] leading-relaxed text-soft">Nenhuma tarefa, horário, refeição ou prazo para hoje.</p>
          <button type="button" onClick={onCreate} className="press mt-4 inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
            Planejar algo
          </button>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="space-y-6">
          {items.length > 0 && (
            <section aria-label="Linha do dia">
              <SectionTitle action="Criar" onAction={onCreate}>
                Seu dia
              </SectionTitle>
              {cleared && (
                <p className="card mb-3 flex items-center gap-3 px-5 py-4 text-[15px] font-medium">
                  <Celebrate active onMount>
                    <span className="grid size-7 place-items-center rounded-full bg-income/15 text-income">
                      <Check size={16} strokeWidth={2.6} />
                    </span>
                  </Celebrate>
                  Tudo feito por hoje
                </p>
              )}
              <DayTimeline items={items} today={today} nowTime={nowTime} onOpen={openItem} periods />
            </section>
          )}
        </div>
        <div className="space-y-6">
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
                      <ChevronRight size={16} className="shrink-0 text-accent-hi" />
                    </button>
                  )
                })}
              </div>
            </Block>
          )}
          {appointments.length > 0 && (
            <Block title="Próximos dias" action="Agenda" onAction={() => navigate('/agenda')}>
              <div className="card p-1.5">
                {appointments.map((i) => (
                  <button key={i.key} type="button" onClick={() => openItem(i)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left hover:bg-tint/[0.03] tap">
                    <span className="num w-[5.5rem] shrink-0 text-[13px] text-soft first-letter:uppercase">
                      {dayWords(i.date, today)} {i.start}
                    </span>
                    <span className={`size-2 shrink-0 rounded-full ${dotOf(i)}`} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{i.title}</span>
                  </button>
                ))}
              </div>
            </Block>
          )}
        </div>
      </div>
      <TaskForm open={taskSheet.open} onClose={taskSheet.close} task={taskSheet.item} />
      {sheets}
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

/**
 * Hoje: one view of the day split into Manhã · Tarde · Noite. The short start-of-day and end-of-day summaries
 * (Começar o dia / Fechar o dia) are one tap away when they fit the clock, and still open with ?mode=.
 */
export function TodayPage() {
  const { data, settings } = useStore()
  const { params } = useRoute()
  const tz = zoneOf(settings)
  const today = useToday(tz)
  // Follows the clock: states (Em horário → Aguardando confirmação) update while the screen stays open.
  const clock = useNow(30_000)
  const { hour, time: nowTime } = nowIn(tz, clock)
  const asked = params.get('mode')
  const [mode, setMode] = useState<DayMode>(asked === 'morning' || asked === 'night' ? asked : 'day')
  useEffect(() => {
    if (asked === 'morning' || asked === 'night' || asked === 'day') setMode(asked)
  }, [asked])
  const create = useSheet<null>()
  const items = useMemo(() => buildAgenda(data, settings, today, today, clock), [data, settings, today, clock])
  const plan = useMemo(() => (mode === 'day' ? null : planDay(data, settings, new Date(), today)), [mode, data, settings, today])
  const tomorrowPlan = useMemo(() => (mode === 'night' ? planDay(data, settings, new Date(), addDaysToDate(today, 1)) : null), [mode, data, settings, today])
  const hint = hour >= 4 && hour < 12 ? { to: 'morning' as const, label: 'Começar o dia' } : hour >= 18 || hour < 4 ? { to: 'night' as const, label: 'Fechar o dia' } : null

  const t = tally(items)
  const late = isEnabled(settings, 'tasks') ? data.tasks.filter((x) => x.status !== 'done' && x.dueDate && (x.dueDate < today || (x.dueDate === today && !!x.dueTime && x.dueTime < nowTime))).length : 0
  const next = nextUp(items, today, nowTime)

  return (
    <>
      <PageHeader
        rich
        icon={CalendarCheck}
        eyebrow={LONG_DATE.format(new Date(`${today}T12:00:00Z`))}
        title="Hoje"
        subtitle={greeting(hour)}
        primary={{ label: 'Criar', aria: 'Criar no seu dia', onPress: () => create.show() }}
        stats={[
          { label: 'Feitos', value: t.total ? `${t.done}/${t.total}` : '—' },
          { label: 'Atrasadas', value: late },
          { label: next && timeState(next, today, nowTime) === 'now' ? 'Agora' : 'Próximo', value: next?.start || '—' },
        ]}
        actions={
          <button type="button" onClick={() => navigate('/assistant')} className="press flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[14px] font-medium text-soft hover:text-ink">
            <MessageCircle size={16} /> Assistente
          </button>
        }
      />
      <div className="mb-5 flex min-h-6 flex-wrap items-center gap-3">
        {mode !== 'day' ? (
          <button type="button" onClick={() => (setMode('day'), clearParams())} className="hit relative flex items-center gap-1 text-[14px] font-medium text-accent-hi hover:text-ink">
            <ChevronLeft size={16} /> Voltar ao dia
          </button>
        ) : (
          hint && (
            <button type="button" onClick={() => setMode(hint.to)} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-accent/[0.1] px-3.5 text-[14px] font-medium text-accent-hi hover:bg-accent/[0.16]">
              {hint.to === 'morning' ? <Sunrise size={16} /> : <Moon size={16} />} {hint.label}
            </button>
          )
        )}
      </div>
      <Suspense fallback={null}>
        {mode === 'day' && <DayView today={today} items={items} nowTime={nowTime} onCreate={() => create.show()} />}
        {mode === 'morning' && plan && <MorningView plan={plan} greeting={greeting(hour)} />}
        {mode === 'night' && plan && tomorrowPlan && <NightView plan={plan} tomorrowPlan={tomorrowPlan} />}
      </Suspense>
      <CreateSheet open={create.open} onClose={create.close} />
    </>
  )
}
