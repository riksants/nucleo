import { AnimatePresence } from 'framer-motion'
import { CalendarCheck, ChevronRight, MessageCircle, Minus, Plus, Search, Settings, Sparkles } from 'lucide-react'
import { lazy, Suspense, type ReactNode } from 'react'
import { isEnabled } from '../../app/modules'
import { HeaderNavButton, Wordmark } from '../../app/Shell'
import { LogoTile } from '../../app/SideMenu'
import { usePrimaryAction } from '../../app/primaryAction'
import { navigate } from '../../app/router'
import { optionOf, PROJECT_STATUS } from '../../data/labels'
import { ACTIVE_PROJECT_STATUSES, sortByNewest, sortOpenTasks, totalsSince, upcomingCharges } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Goal, Project, Task, Transaction } from '../../data/types'
import { formatDateValue, formatWeekday, monthName, periodStart, relativeDays } from '../../lib/dates'
import { addDaysToDate, todayIn, zoneOf } from '../../core/period'
import { useNow } from '../../lib/hooks'
import { formatMoney } from '../../lib/money'
import { IconButton } from '../../ui/Button'

/** Up to 3 suggestions; its code loads after the screen (startup stays light). */
const AttentionCard = lazy(() => import('../assistant/Insights').then((m) => ({ default: m.AttentionCard })))
import { Badge, SectionTitle } from '../../ui/Display'
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

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

/** Round quick action on the band: a white disc with a vermilion stroke icon and its name under it (bank-app style). */
function QuickAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="press group flex min-w-0 flex-col items-center gap-2 text-[13px] font-semibold">
      <span className="grid size-14 place-items-center rounded-full bg-white text-brand shadow-[0_2px_8px_-2px_rgb(10_10_11/0.25)] transition-colors group-hover:bg-white/90">{icon}</span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

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

export function HomePage() {
  const { data, settings, displayCurrency, convert } = useStore()
  const txSheet = useSheet<Transaction>()
  const newTx = useSheet<'in' | 'out'>()
  // Início has its own main actions (Adicionar, Retirar, Hoje, Assistente): no floating "+".
  usePrimaryAction(null)
  const taskSheet = useSheet<Task>()
  const goalSheet = useSheet<Goal>()

  // Follows the clock: greeting, weekday and month update while the app stays open.
  const today = useNow()
  const month = totalsSince(data.transactions, periodStart('month', today))
  const show = (cents: number) => {
    const v = convert(cents, settings.baseCurrency, displayCurrency)
    return v === null ? formatMoney(cents, settings.baseCurrency) : formatMoney(v, displayCurrency)
  }

  const recent = sortByNewest(data.transactions).slice(0, 4)
  const openTasks = sortOpenTasks(data.tasks.filter((t) => t.status !== 'done'))
  // "Para hoje": what is late or due today; otherwise the next pending tasks.
  // The day in the person's time zone (Configurações), the same rule Hoje uses.
  const todayKey = todayIn(zoneOf(settings), today)
  const dueNow = openTasks.filter((t) => t.dueDate && t.dueDate <= todayKey)
  const taskList = dueNow.length ? dueNow : openTasks
  const late = openTasks.filter((t) => t.dueDate && t.dueDate < todayKey).length
  const dueToday = dueNow.length - late
  const activeProjects = sortByNewest(data.projects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)))
  const goals = sortByNewest(data.goals.filter((g) => !g.purchasedAt)).slice(0, 2)
  const charges = upcomingCharges(data.tools, 30, today).slice(0, 4)
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)
  // Automations: charges waiting for the person, and what the Núcleo did in the last 7 days.
  const pending = pendingRuns(data.automationRuns)
  const doneLately = historyRuns(data.automationRuns).filter((r) => r.status === 'done' && r.date >= addDaysToDate(todayKey, -7))

  return (
    <>
      {/* The vermilion band (bank-app home): menu, brand and shortcuts; greeting; the balance; quick actions. */}
      <header className="band -mx-5 mb-7 px-5 pt-[calc(env(safe-area-inset-top)+6px)] pb-7 lg:mx-0 lg:mb-8 lg:rounded-[1.75rem] lg:px-8 lg:pt-7 lg:pb-8">
        <div className="flex h-12 items-center gap-2 lg:hidden">
          <HeaderNavButton />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <LogoTile className="size-8" />
            <Wordmark className="text-[14px]" />
          </span>
          <IconButton label="Buscar" className="text-coal hover:bg-coal/[0.08]" onClick={() => navigate('/search')}>
            <Search size={24} />
          </IconButton>
          <IconButton label="Configurações" className="-mr-2 text-coal hover:bg-coal/[0.08]" onClick={() => navigate('/settings')}>
            <Settings size={24} />
          </IconButton>
        </div>
        <div className="mt-4 lg:mt-0">
          <p className="text-[14px] font-medium text-coal/75 first-letter:uppercase">{formatWeekday(today)}</p>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.04em] lg:text-[40px]">{greeting(today)}</h1>
        </div>

        {on('finance') && (
          <div className="mt-6">
            <BalanceCard
              variant="hero"
              note={
                month.income || month.expense ? (
                  <span>
                    {month.net > 0 ? '+' : ''}
                    {show(month.net)} <span className="font-medium text-coal/75">em {monthName(today)}</span>
                  </span>
                ) : undefined
              }
            />
          </div>
        )}

        {/* Quick actions: round, with names. Money first when Financeiro is on. */}
        <nav aria-label="Ações rápidas" className="mt-6 grid grid-cols-4 gap-2 lg:max-w-md">
          {on('finance') && <QuickAction label="Adicionar" icon={<Plus size={24} strokeWidth={2.4} />} onClick={() => newTx.show('in')} />}
          {on('finance') && <QuickAction label="Retirar" icon={<Minus size={24} strokeWidth={2.4} />} onClick={() => newTx.show('out')} />}
          {on('today') && <QuickAction label="Hoje" icon={<CalendarCheck size={24} />} onClick={() => navigate('/today')} />}
          <QuickAction label="Assistente" icon={<MessageCircle size={24} />} onClick={() => navigate('/assistant')} />
        </nav>
      </header>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-7">

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

          {on('finance') && (
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-4">
                <p className="text-[13px] text-soft first-letter:uppercase">Entrou em {monthName(today)}</p>
                <p className={`num mt-1 text-[20px] leading-tight font-semibold [overflow-wrap:anywhere] ${month.income ? 'text-income' : 'text-soft'}`}>{show(month.income)}</p>
              </div>
              <div className="card p-4">
                <p className="text-[13px] text-soft first-letter:uppercase">Saiu em {monthName(today)}</p>
                <p className={`num mt-1 text-[20px] leading-tight font-semibold [overflow-wrap:anywhere] ${month.expense ? 'text-expense' : 'text-soft'}`}>{show(month.expense)}</p>
              </div>
            </div>
          )}

          <Suspense fallback={null}>
            <AttentionCard />
          </Suspense>

        {on('finance') && (
        <div className="space-y-7">

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
        </div>
        )}
        </div>

        <div className="min-w-0 space-y-7">
          {on('tasks') && on('today') && (
            // Início is the overview; the list itself lives in Hoje.
            <Block title="Hoje">
              <button type="button" onClick={() => navigate('/today')} className="card tap flex w-full items-center gap-3.5 p-4 text-left">
                <span className="grid size-11 shrink-0 place-items-center rounded-full icon-tile">
                  <CalendarCheck size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">
                    {dueToday ? `${dueToday} ${dueToday === 1 ? 'tarefa' : 'tarefas'} para hoje` : openTasks.length ? 'Nada vencendo hoje' : 'Nenhuma tarefa pendente'}
                  </span>
                  <span className="block truncate text-[13px] text-soft">
                    {late ? <span className="font-semibold text-expense">{late} {late === 1 ? 'atrasada' : 'atrasadas'} · </span> : null}
                    {taskList[0] ? `Próxima: ${taskList[0].title}` : 'Ver o dia'}
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-accent-hi" />
              </button>
            </Block>
          )}

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

          {on('projects') && (
          <Block title={activeProjects.length ? `Projetos de trabalho ativos · ${activeProjects.length}` : 'Projetos de trabalho'} action={activeProjects.length ? 'Ver todos' : undefined} onAction={() => navigate('/projects')}>
            {activeProjects.length ? (
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
            ) : (
              <EmptyLine text="Nenhum projeto ativo" action="Ver projetos" onAction={() => navigate('/projects')} />
            )}
          </Block>
          )}

          {on('goals') && (
          <Block title="Metas de compra" action={goals.length ? 'Ver todas' : undefined} onAction={() => navigate('/goals')}>
            {goals.length ? (
              <div className="grid gap-3">
                {goals.map((g) => (
                  <GoalCard key={g.id} goal={g} onOpen={goalSheet.show} compact />
                ))}
              </div>
            ) : (
              <EmptyLine text="Nenhuma meta ainda" action="Nova meta" onAction={() => goalSheet.show()} />
            )}
          </Block>
          )}

          {on('tools') && (
          <Block title="Próximas cobranças" action={charges.length ? 'Assinaturas' : undefined} onAction={() => navigate('/tools')}>
            {charges.length ? (
              <div className="card p-1.5">
                {charges.map(({ tool, date }) => {
                  const rel = relativeDays(date, today)
                  return (
                    <button key={tool.id} type="button" onClick={() => navigate('/tools', { open: tool.id })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.03] tap">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{tool.name}</span>
                        <span className={`text-[13px] ${rel && rel.days <= 1 ? 'text-warn' : 'text-faint'}`}>
                          {formatDateValue(date)} · {rel?.label}
                        </span>
                      </span>
                      <span className="num text-[15px] font-semibold">{formatMoney(tool.price, tool.currency)}</span>
                      <ChevronRight size={16} className="text-accent-hi" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <EmptyLine text="Nada a pagar nos próximos 30 dias" action="Assinaturas" onAction={() => navigate('/tools')} />
            )}
          </Block>
          )}
        </div>
      </div>

      <TransactionSheet type="in" open={txSheet.open} editing={txSheet.item} onClose={txSheet.close} />
      <TransactionSheet type={newTx.item ?? 'in'} open={newTx.open} onClose={newTx.close} />
      <TaskForm open={taskSheet.open} onClose={taskSheet.close} task={taskSheet.item} />
      <GoalForm open={goalSheet.open} onClose={goalSheet.close} goal={goalSheet.item} />
    </>
  )
}
