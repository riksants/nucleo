import { AnimatePresence } from 'framer-motion'
import { ChevronRight, Crosshair } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { navigate } from '../../app/router'
import { mealsMorningLine, morningSentence, type DayPlan } from '../../core/day'
import { nowIn, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import type { Task } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { AgendaRow } from '../agenda/AgendaRow'
import { useOpenItem } from '../agenda/openItem'
import { TaskForm } from '../tasks/TaskForm'
import { TaskRow } from '../tasks/TaskRow'

const LIMIT = 4

function Block({ title, children, more, onMore }: { title: string; children: ReactNode; more?: number; onMore?(): void }) {
  return (
    <section>
      <SectionTitle action={more ? `Ver mais ${more}` : undefined} onAction={onMore}>
        {title}
      </SectionTitle>
      {children}
    </section>
  )
}

/** Quick start of the day: one sentence, then only the most important items. */
export function MorningView({ plan, greeting }: { plan: DayPlan; greeting: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const taskSheet = useSheet<Task>()
  const { open, sheets } = useOpenItem()
  const cut = <T,>(key: string, list: T[]) => (expanded[key] ? list : list.slice(0, LIMIT))
  const more = (key: string, list: unknown[]) => (!expanded[key] && list.length > LIMIT ? list.length - LIMIT : undefined)
  const show = (key: string) => setExpanded((e) => ({ ...e, [key]: true }))
  const { settings } = useStore()
  const nowTime = nowIn(zoneOf(settings)).time
  const ahead = plan.timed.filter((i) => i.status !== 'done' && i.status !== 'skipped')
  const timeline = [...plan.events, ...ahead].sort((a, b) => a.start.localeCompare(b.start))
  const anytime = plan.anytime.filter((i) => i.kind !== 'task' || !plan.priorities.some((p) => i.source.kind === 'task' && i.source.task.id === p.id))

  return (
    <div className="space-y-7">
      <div className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_80%_at_0%_0%,rgb(91_108_255/0.16),transparent_60%)]" aria-hidden />
        <p className="relative text-[22px] font-semibold tracking-tight">{greeting}.</p>
        <p className="relative mt-1 text-[16px] leading-relaxed text-soft">{morningSentence(plan)}</p>
        {mealsMorningLine(plan) && <p className="relative mt-1.5 text-[14px] leading-relaxed text-faint">{mealsMorningLine(plan)}</p>}
      </div>

      {plan.priorities.length > 0 && (
        <Block title="Prioridades">
          <div className="card p-1.5">
            <AnimatePresence initial={false}>
              {plan.priorities.map((t) => (
                <div key={t.id} className="flex items-center">
                  <div className="min-w-0 flex-1">
                    <TaskRow task={t} onOpen={taskSheet.show} />
                  </div>
                  <button type="button" aria-label={`Focar em ${t.title}`} title="Modo foco" onClick={() => navigate('/focus', { task: t.id })} className="mr-1 grid size-10 shrink-0 place-items-center rounded-xl text-faint hover:bg-white/[0.04] hover:text-accent-hi">
                    <Crosshair size={18} />
                  </button>
                </div>
              ))}
            </AnimatePresence>
          </div>
        </Block>
      )}

      {timeline.length > 0 && (
        <Block title="Agenda de hoje" more={more('agenda', timeline)} onMore={() => show('agenda')}>
          <div className="card p-1.5">
            {cut('agenda', timeline).map((i) => (
              <AgendaRow key={i.key} item={i} onOpen={open} />
            ))}
          </div>
          {timeline.some((i) => i.start < nowTime) && <p className="mt-2 px-1 text-[12.5px] text-faint">Itens que já passaram continuam aqui até você marcar.</p>}
        </Block>
      )}

      {anytime.length > 0 && (
        <Block title="Para fazer hoje" more={more('anytime', anytime)} onMore={() => show('anytime')}>
          <div className="card p-1.5">
            {cut('anytime', anytime).map((i) => (
              <AgendaRow key={i.key} item={i} onOpen={open} />
            ))}
          </div>
        </Block>
      )}

      {plan.overdue.length > 0 && (
        <Block title={`Atrasadas · ${plan.overdue.length}`} more={more('overdue', plan.overdue)} onMore={() => show('overdue')}>
          <div className="card p-1.5">
            <AnimatePresence initial={false}>
              {cut('overdue', plan.overdue).map((t) => (
                <TaskRow key={t.id} task={t} onOpen={taskSheet.show} />
              ))}
            </AnimatePresence>
          </div>
        </Block>
      )}

      {plan.money.length > 0 && (
        <Block title="Contas e cobranças de hoje">
          <div className="card p-1.5">
            {plan.money.map((m) => (
              <button key={m.key} type="button" onClick={() => navigate(m.path, { open: m.id })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left hover:bg-white/[0.03]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{m.title}</span>
                  <span className="text-[13px] text-faint">{m.direction === 'pay' ? 'Você paga' : 'Você recebe'} · {m.detail}</span>
                </span>
                <span className={`num shrink-0 text-[15px] font-semibold ${m.direction === 'receive' ? 'text-income' : ''}`}>{formatMoney(m.cents, m.currency)}</span>
                <ChevronRight size={16} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
        </Block>
      )}

      <TaskForm open={taskSheet.open} onClose={taskSheet.close} task={taskSheet.item} />
      {sheets}
    </div>
  )
}
