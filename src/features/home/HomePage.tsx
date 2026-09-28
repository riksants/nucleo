import { AnimatePresence } from 'framer-motion'
import { ChevronRight, Search, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { navigate } from '../../app/router'
import { optionOf, PROJECT_STATUS } from '../../data/labels'
import { ACTIVE_PROJECT_STATUSES, sortByNewest, sortOpenTasks, totalsSince, upcomingCharges } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Goal, Project, Task, Transaction } from '../../data/types'
import { formatDateValue, formatWeekday, monthName, periodStart, relativeDays } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { IconButton } from '../../ui/Button'
import { Badge, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { BalanceCard } from '../finance/BalanceCard'
import { TransactionRow } from '../finance/TransactionList'
import { TransactionSheet } from '../finance/TransactionSheet'
import { GoalCard } from '../goals/GoalCard'
import { GoalForm } from '../goals/GoalForm'
import { DueLabel } from '../projects/ProjectCard'
import { TaskForm } from '../tasks/TaskForm'
import { TaskRow } from '../tasks/TaskRow'

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
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
      <button type="button" onClick={onAction} className="shrink-0 text-sm font-medium text-accent-hi hover:text-ink">
        {action}
      </button>
    </div>
  )
}

export function HomePage() {
  const { data, settings, displayCurrency, convert } = useStore()
  const txSheet = useSheet<Transaction>()
  const taskSheet = useSheet<Task>()
  const goalSheet = useSheet<Goal>()

  const month = totalsSince(data.transactions, periodStart('month'))
  const show = (cents: number) => {
    const v = convert(cents, settings.baseCurrency, displayCurrency)
    return v === null ? formatMoney(cents, settings.baseCurrency) : formatMoney(v, displayCurrency)
  }

  const recent = sortByNewest(data.transactions).slice(0, 4)
  const openTasks = sortOpenTasks(data.tasks.filter((t) => t.status !== 'done'))
  const activeProjects = sortByNewest(data.projects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)))
  const goals = sortByNewest(data.goals.filter((g) => !g.purchasedAt)).slice(0, 2)
  const charges = upcomingCharges(data.tools, 30).slice(0, 4)
  const today = new Date()

  return (
    <>
      <header className="mb-5 flex items-center justify-between gap-3 lg:mb-8">
        <div>
          <p className="text-[13px] font-medium text-faint first-letter:uppercase">{formatWeekday(today)}</p>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] lg:text-[34px]">{greeting(today)}</h1>
        </div>
        <div className="flex gap-1 lg:hidden">
          <IconButton label="Buscar" onClick={() => navigate('/search')}>
            <Search size={21} />
          </IconButton>
          <IconButton label="Configurações" onClick={() => navigate('/settings')}>
            <Settings size={21} />
          </IconButton>
        </div>
      </header>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="space-y-7">
          <div className="space-y-3">
            <BalanceCard />
            <div className="card grid grid-cols-2 divide-x divide-line">
              <div className="p-4 pl-5">
                <p className="text-[13px] text-soft first-letter:uppercase">Entrou em {monthName(today)}</p>
                <p className={`num mt-1 text-[20px] font-semibold ${month.income ? 'text-income' : 'text-soft'}`}>{show(month.income)}</p>
              </div>
              <div className="p-4 pl-5">
                <p className="text-[13px] text-soft first-letter:uppercase">Saiu em {monthName(today)}</p>
                <p className={`num mt-1 text-[20px] font-semibold ${month.expense ? 'text-expense' : 'text-soft'}`}>{show(month.expense)}</p>
              </div>
            </div>
          </div>

          <Block title="Movimentações recentes" action={recent.length ? 'Ver tudo' : undefined} onAction={() => navigate('/finance')}>
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

        <div className="space-y-7">
          <Block title={openTasks.length ? `Tarefas pendentes · ${openTasks.length}` : 'Tarefas'} action={openTasks.length ? 'Ver todas' : undefined} onAction={() => navigate('/tasks')}>
            {openTasks.length ? (
              <div className="card p-1.5">
                <AnimatePresence initial={false}>
                  {openTasks.slice(0, 4).map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={taskSheet.show} />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <EmptyLine text="Nenhuma tarefa pendente" action="Adicionar" onAction={() => taskSheet.show()} />
            )}
          </Block>

          <Block title={activeProjects.length ? `Projetos ativos · ${activeProjects.length}` : 'Projetos'} action={activeProjects.length ? 'Ver todos' : undefined} onAction={() => navigate('/projects')}>
            {activeProjects.length ? (
              <div className="card p-1.5">
                {activeProjects.slice(0, 3).map((p: Project) => {
                  const s = optionOf(PROJECT_STATUS, p.status)
                  return (
                    <button key={p.id} type="button" onClick={() => navigate('/projects', { open: p.id })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]">
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

          <Block title="Metas" action={goals.length ? 'Ver todas' : undefined} onAction={() => navigate('/goals')}>
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

          <Block title="Próximas cobranças" action={charges.length ? 'Ferramentas' : undefined} onAction={() => navigate('/tools')}>
            {charges.length ? (
              <div className="card p-1.5">
                {charges.map(({ tool, date }) => {
                  const rel = relativeDays(date)
                  return (
                    <button key={tool.id} type="button" onClick={() => navigate('/tools', { open: tool.id })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{tool.name}</span>
                        <span className={`text-[13px] ${rel && rel.days <= 3 ? 'text-warn' : 'text-faint'}`}>
                          {formatDateValue(date)} · {rel?.label}
                        </span>
                      </span>
                      <span className="num text-[15px] font-semibold">{formatMoney(tool.price, tool.currency)}</span>
                      <ChevronRight size={16} className="text-faint" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <EmptyLine text="Nada a pagar nos próximos 30 dias" action="Ferramentas" onAction={() => navigate('/tools')} />
            )}
          </Block>
        </div>
      </div>

      <TransactionSheet type="in" open={txSheet.open} editing={txSheet.item} onClose={txSheet.close} />
      <TaskForm open={taskSheet.open} onClose={taskSheet.close} task={taskSheet.item} />
      <GoalForm open={goalSheet.open} onClose={goalSheet.close} goal={goalSheet.item} />
    </>
  )
}
