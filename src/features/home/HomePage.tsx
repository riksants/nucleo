import { AnimatePresence } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, Check, ChevronRight, MessageCircle, Minus, Plus, Search, Settings, Sparkles } from 'lucide-react'
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { isEnabled } from '../../app/modules'
import { HeaderNavButton, Wordmark } from '../../app/Shell'
import { LogoTile } from '../../app/SideMenu'
import { usePrimaryAction } from '../../app/primaryAction'
import { navigate } from '../../app/router'
import { homeFocus, type FocusLine } from '../../core/homeFocus'
import { optionOf, PROJECT_STATUS } from '../../data/labels'
import { ACTIVE_PROJECT_STATUSES, sortByNewest, sortOpenTasks, totalsSince, upcomingCharges } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Goal, Project, Task, Transaction } from '../../data/types'
import { formatDateValue, monthName, periodStart, relativeDays } from '../../lib/dates'
import { nowIn, todayIn, zoneOf } from '../../core/period'
import { addDaysToDate } from '../../core/period'
import { useNow } from '../../lib/hooks'
import { formatMoney } from '../../lib/money'
import { IconButton } from '../../ui/Button'

/** Up to 3 suggestions; its code loads after the screen (startup stays light). */
const AttentionCard = lazy(() => import('../assistant/Insights').then((m) => ({ default: m.AttentionCard })))
import { Progress, Badge, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { BalanceCard } from '../finance/BalanceCard'
import { TransactionRow } from '../finance/TransactionList'
import { TransactionSheet } from '../finance/TransactionSheet'
import { GoalCard } from '../goals/GoalCard'
import { GoalForm } from '../goals/GoalForm'
import { DueLabel } from '../projects/ProjectCard'
import { PendingCharges } from '../automations/PendingCharges'
import { historyRuns, pendingRuns } from '../automations/runs'
import { TaskForm } from '../tasks/TaskForm'
import { TaskRow } from '../tasks/TaskRow'
import { HomeSuggestion } from '../rules/SuggestionCard'
import { useOpenItem } from '../agenda/openItem'
import { useToggleItem } from '../agenda/AgendaRow'
import { useDailyActions } from '../../core/actions'
import { isMarkable } from '../../core/timeState'
import { CreateSheet } from '../daily/CreateSheet'

/** By the hour of the person's time zone (Configurações), like Hoje. */
function greeting(hour: number) {
  return hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
}

/** One action of the dock under the band: a vermilion-tint tile with the glyph, its name under it. */
function QuickAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="press group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl py-1 text-[13px] font-semibold tracking-[-0.01em]">
      <span className="icon-tile grid size-12 place-items-center rounded-2xl transition-transform duration-200 group-hover:-translate-y-0.5">{icon}</span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

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

function EmptyLine({ text, action, onAction }: { text: string; action: string; onAction(): void }) {
  return (
    <div className="card flex items-center justify-between gap-3 px-5 py-4">
      <span className="text-[15px] text-faint">{text}</span>
      <button type="button" onClick={onAction} className="hit relative shrink-0 text-sm font-medium text-accent-hi hover:text-ink">
        {action}
      </button>
    </div>
  )
}

const TONE: Record<FocusLine['tone'], string> = {
  now: 'bg-accent text-on-accent',
  soon: 'bg-accent/[0.14] text-accent-hi',
  late: 'bg-expense/[0.14] text-expense',
  today: 'bg-tint/[0.07] text-soft',
  confirm: 'bg-warn/[0.14] text-warn',
  money: 'bg-tint/[0.07] text-soft',
  later: 'bg-tint/[0.07] text-soft',
}

/**
 * "Agora": the one thing that matters at this moment, up to three more lines, and the day's progress — from the
 * real records, never repeated. Nothing pending: a clean "Tudo em dia".
 */
function FocusCard({ onCreate, onOpenTask }: { onCreate(): void; onOpenTask(task: Task): void }) {
  const { data, settings } = useStore()
  const clock = useNow(30_000)
  const focus = useMemo(() => homeFocus(data, settings, clock), [data, settings, clock])
  const { open, sheets } = useOpenItem()
  const toggle = useToggleItem()
  const { completeTask } = useDailyActions()

  const go = (l: FocusLine) => {
    const t = l.target
    if (t.kind === 'item') open(t.item)
    else if (t.kind === 'task') onOpenTask(t.task)
    else navigate(t.money.path, { open: t.money.id })
  }
  const canDone = (l: FocusLine) => (l.target.kind === 'task' ? true : l.target.kind === 'item' ? isMarkable(l.target.item) : false)
  const markDone = (l: FocusLine) => (l.target.kind === 'task' ? completeTask(l.target.task, true) : l.target.kind === 'item' ? toggle(l.target.item, 'done') : undefined)
  const { lead, lines, progress } = focus

  return (
    <section aria-label="Agora" className="card overflow-hidden">
      {lead ? (
        <div className="relative p-4 pl-5">
          <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${lead.tone === 'now' || lead.tone === 'soon' ? 'bg-accent' : lead.tone === 'late' ? 'bg-expense' : 'bg-tint/15'}`} />
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => go(lead)} className="min-w-0 flex-1 text-left">
              <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold ${TONE[lead.tone]}`}>{lead.label}</span>
              <span className="mt-1.5 block text-[19px] leading-snug font-semibold tracking-[-0.03em] [overflow-wrap:anywhere]">{lead.title}</span>
              <span className="mt-0.5 block truncate text-[14px] text-soft">{lead.detail}</span>
            </button>
            {canDone(lead) && (
              <button type="button" onClick={() => markDone(lead)} aria-label={`Concluir ${lead.title}`} className="press mt-1 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[14px] font-semibold text-on-accent hover:bg-accent-soft">
                <Check size={16} strokeWidth={2.6} /> Feito
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3.5 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-income/[0.14] text-income">
            <Check size={20} strokeWidth={2.4} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Tudo em dia</span>
            <span className="block text-[13px] text-soft">{progress.total ? 'Nada pendente agora.' : 'Nada programado para hoje.'}</span>
          </span>
          <button type="button" onClick={onCreate} className="hit relative shrink-0 text-[14px] font-medium text-accent-hi hover:text-ink">
            Planejar
          </button>
        </div>
      )}
      {lines.length > 0 && (
        <ul className="border-t border-line px-1.5 py-1">
          {lines.map((l) => (
            <li key={l.key}>
              <button type="button" onClick={() => go(l)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-tint/[0.03] tap">
                <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold ${TONE[l.tone]}`}>{l.label}</span>
                <span className="min-w-0 flex-1 truncate text-[15px]">{l.title}</span>
                <ChevronRight size={16} className="shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {progress.total > 0 && (
        <button type="button" onClick={() => navigate('/today')} className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left hover:bg-tint/[0.03]">
          <span className="min-w-0 flex-1">
            <Progress value={(progress.done / progress.total) * 100} tone="accent" />
          </span>
          <span className="num shrink-0 text-[13px] font-medium text-soft">
            {progress.done} de {progress.total} hoje
          </span>
          <ChevronRight size={16} className="shrink-0 text-accent-hi" />
        </button>
      )}
      {sheets}
    </section>
  )
}

export function HomePage() {
  const { data, settings, displayCurrency, convert } = useStore()
  const txSheet = useSheet<Transaction>()
  const newTx = useSheet<'in' | 'out'>()
  // Início has its own main actions (Criar, Adicionar, Retirar, Hoje): no floating "+".
  usePrimaryAction(null)
  const taskSheet = useSheet<Task>()
  const goalSheet = useSheet<Goal>()
  const create = useSheet<null>()

  // Follows the clock: greeting, weekday and month update while the app stays open.
  const today = useNow()
  const n = nowIn(zoneOf(settings), today)
  const month = totalsSince(data.transactions, periodStart('month', today))
  const show = (cents: number) => {
    const v = convert(cents, settings.baseCurrency, displayCurrency)
    return v === null ? formatMoney(cents, settings.baseCurrency) : formatMoney(v, displayCurrency)
  }

  const recent = sortByNewest(data.transactions).slice(0, 4)
  const openTasks = sortOpenTasks(data.tasks.filter((t) => t.status !== 'done'))
  const todayKey = todayIn(zoneOf(settings), today)
  const dueNow = openTasks.filter((t) => t.dueDate && t.dueDate <= todayKey)
  const taskList = dueNow.length ? dueNow : openTasks
  const late = openTasks.filter((t) => t.dueDate && t.dueDate < todayKey).length
  const dueToday = dueNow.length - late
  const activeProjects = sortByNewest(data.projects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)))
  const goals = sortByNewest(data.goals.filter((g) => !g.purchasedAt)).slice(0, 2)
  // Today and tomorrow already show in "Agora": here only what comes after.
  const charges = upcomingCharges(data.tools, 30, today)
    .filter((c) => c.date > addDaysToDate(todayKey, 1))
    .slice(0, 3)
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)
  const pending = pendingRuns(data.automationRuns, undefined, todayKey)
  const doneLately = historyRuns(data.automationRuns).filter((r) => r.status === 'done' && r.date >= addDaysToDate(todayKey, -7))
  // One line under the greeting with the day at a glance (only what exists, nothing invented).
  const eventsToday = on('agenda') ? data.events.filter((e) => e.date === todayKey).length : 0
  const glance = [
    dueToday > 0 && `${dueToday} ${dueToday === 1 ? 'tarefa' : 'tarefas'} para hoje`,
    late > 0 && `${late} ${late === 1 ? 'atrasada' : 'atrasadas'}`,
    eventsToday > 0 && `${eventsToday} ${eventsToday === 1 ? 'compromisso' : 'compromissos'}`,
  ].filter(Boolean) as string[]
  const dayOn = on('today') || on('tasks') || on('agenda') || on('habits') || on('recurring')
  // Up to four actions, the most used first; Assistente fills the dock when a section is off.
  const dock = [
    dayOn && <QuickAction key="c" label="Criar" icon={<Sparkles size={24} />} onClick={() => create.show()} />,
    on('finance') && <QuickAction key="i" label="Adicionar" icon={<Plus size={24} strokeWidth={2.4} />} onClick={() => newTx.show('in')} />,
    on('finance') && <QuickAction key="o" label="Retirar" icon={<Minus size={24} strokeWidth={2.4} />} onClick={() => newTx.show('out')} />,
    on('today') && <QuickAction key="h" label="Hoje" icon={<CalendarCheck size={24} />} onClick={() => navigate('/today')} />,
    <QuickAction key="a" label="Assistente" icon={<MessageCircle size={24} />} onClick={() => navigate('/assistant')} />,
  ]
    .filter(Boolean)
    .slice(0, 4)

  return (
    <>
      {/* The vermilion band: menu, brand and shortcuts; the day; the balance. Coal type on light, white on dark. */}
      <header className="band band-depth band-home relative isolate -mx-5 overflow-hidden px-5 pt-[calc(env(safe-area-inset-top)+6px)] pb-14 lg:mx-0 lg:rounded-[1.75rem] lg:px-8 lg:pt-7 lg:pb-14">
        <div className="flex h-12 items-center gap-2 lg:hidden">
          <HeaderNavButton />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <LogoTile className="size-8" />
            <Wordmark className="text-[14px] max-[359px]:hidden" />
          </span>
          <IconButton label="Assistente" className="text-coal hover:bg-coal/[0.08]" onClick={() => navigate('/assistant')}>
            <MessageCircle size={24} />
          </IconButton>
          <IconButton label="Buscar" className="text-coal hover:bg-coal/[0.08]" onClick={() => navigate('/search')}>
            <Search size={24} />
          </IconButton>
          <IconButton label="Configurações" className="-mr-2 text-coal hover:bg-coal/[0.08]" onClick={() => navigate('/settings')}>
            <Settings size={24} />
          </IconButton>
        </div>
        <div className="mt-2 lg:mt-0">
          <p className="text-[12px] font-semibold tracking-[0.1em] text-coal/75 uppercase">{LONG_DATE.format(new Date(`${todayKey}T12:00:00Z`))}</p>
          <h1 className="mt-0.5 text-[30px] leading-tight font-semibold tracking-[-0.045em] lg:text-[42px]">{greeting(n.hour)}</h1>
          {glance.length > 0 && <p className="mt-0.5 text-[15px] font-medium text-coal/80">{glance.join(' · ')}</p>}
        </div>

        {on('finance') && (
          <div className="mt-4 border-t border-coal/[0.14] pt-3">
            <BalanceCard
              variant="hero"
              note={
                month.income || month.expense ? (
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span className="inline-flex items-center gap-1">
                      <ArrowDownLeft size={16} />
                      <span className="num font-semibold">{show(month.income)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpRight size={16} />
                      <span className="num font-semibold">{show(month.expense)}</span>
                    </span>
                    <span className="font-medium text-coal/80">em {monthName(today)}</span>
                  </span>
                ) : undefined
              }
            />
          </div>
        )}
      </header>

      {/* Quick actions in one dock half over the band. */}
      <nav
        aria-label="Ações rápidas"
        style={{ gridTemplateColumns: `repeat(${dock.length}, minmax(0, 1fr))` }}
        className="card relative z-10 -mt-10 mb-6 grid gap-1 rounded-[1.5rem]! px-2 py-3 shadow-[0_18px_40px_-24px_var(--color-shade)]! lg:mx-8 lg:max-w-md"
      >
        {dock}
      </nav>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-7">
          {dayOn && <FocusCard onCreate={() => create.show()} onOpenTask={taskSheet.show} />}

          {pending.length > 0 && (
            <Block title="Esperando você" action={pending.length > 3 ? `Ver ${pending.length}` : 'Ver tudo'} onAction={() => navigate('/automations')}>
              <PendingCharges runs={pending.slice(0, 3)} />
            </Block>
          )}

          {doneLately.length > 0 && (
            <button type="button" onClick={() => navigate('/automations')} className="card flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-tint/[0.03] tap">
              <span className="grid size-9 shrink-0 place-items-center rounded-full icon-tile">
                <Sparkles size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">Feito pelo Núcleo</span>
                <span className="block truncate text-[13px] text-faint">{doneLately.length === 1 ? doneLately[0].summary : `${doneLately.length} ações nos últimos 7 dias · ${doneLately[0].summary}`}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-accent-hi" />
            </button>
          )}

          <HomeSuggestion />

          <Suspense fallback={null}>
            <AttentionCard />
          </Suspense>

          {on('finance') && (
            <Block title="Movimentações" action={recent.length ? 'Ver tudo' : undefined} onAction={() => navigate('/finance')}>
              {recent.length ? (
                <div className="card p-1.5">
                  {recent.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} onOpen={txSheet.show} />
                  ))}
                </div>
              ) : (
                <div className="card px-5 py-4 text-[15px] text-faint">Suas entradas e saídas aparecem aqui.</div>
              )}
            </Block>
          )}
        </div>

        <div className="min-w-0 space-y-7">
          {on('tasks') && !on('today') && (
            <Block title={dueNow.length ? `Para hoje · ${dueNow.length}` : openTasks.length ? `Tarefas pendentes · ${openTasks.length}` : 'Tarefas'} action={openTasks.length ? 'Ver todas' : undefined} onAction={() => navigate('/tasks')}>
              {openTasks.length ? (
                <div className="card p-1.5">
                  <AnimatePresence initial={false}>
                    {taskList.slice(0, 4).map((t) => (
                      <TaskRow key={t.id} task={t} onOpen={taskSheet.show} />
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <EmptyLine text="Nenhuma tarefa pendente" action="Adicionar" onAction={() => taskSheet.show()} />
              )}
            </Block>
          )}

          {on('projects') && activeProjects.length > 0 && (
            <Block title={`Projetos de trabalho ativos · ${activeProjects.length}`} action="Ver todos" onAction={() => navigate('/projects')}>
              <div className="card p-1.5">
                {activeProjects.slice(0, 3).map((p: Project) => {
                  const s = optionOf(PROJECT_STATUS, p.status)
                  return (
                    <button key={p.id} type="button" onClick={() => navigate('/projects', { open: p.id })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.03] tap">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{p.name}</span>
                        {p.dueDate ? <DueLabel date={p.dueDate} /> : <span className="text-[13px] text-faint">Sem prazo</span>}
                      </span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </button>
                  )
                })}
              </div>
            </Block>
          )}

          {on('goals') && goals.length > 0 && (
            <Block title="Metas de compra" action="Ver todas" onAction={() => navigate('/goals')}>
              <div className="grid gap-3">
                {goals.map((g) => (
                  <GoalCard key={g.id} goal={g} onOpen={goalSheet.show} compact />
                ))}
              </div>
            </Block>
          )}

          {on('tools') && charges.length > 0 && (
            <Block title="Próximas cobranças" action="Assinaturas" onAction={() => navigate('/tools')}>
              <div className="card p-1.5">
                {charges.map(({ tool, date }) => {
                  const rel = relativeDays(date, today)
                  return (
                    <button key={tool.id} type="button" onClick={() => navigate('/tools', { open: tool.id })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.03] tap">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{tool.name}</span>
                        <span className="text-[13px] text-faint">
                          {formatDateValue(date)} · {rel?.label}
                        </span>
                      </span>
                      <span className="num text-[15px] font-semibold">{formatMoney(tool.price, tool.currency)}</span>
                      <ChevronRight size={16} className="text-accent-hi" />
                    </button>
                  )
                })}
              </div>
            </Block>
          )}
        </div>
      </div>

      <TransactionSheet type="in" open={txSheet.open} editing={txSheet.item} onClose={txSheet.close} />
      <TransactionSheet type={newTx.item ?? 'in'} open={newTx.open} onClose={newTx.close} />
      <TaskForm open={taskSheet.open} onClose={taskSheet.close} task={taskSheet.item} />
      <GoalForm open={goalSheet.open} onClose={goalSheet.close} goal={goalSheet.item} />
      <CreateSheet open={create.open} onClose={create.close} />
    </>
  )
}
