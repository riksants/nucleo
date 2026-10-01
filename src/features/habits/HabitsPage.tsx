import { Plus, Sprout } from 'lucide-react'
import { useMemo } from 'react'
import { PageHeader } from '../../app/Shell'
import { indexCompletions, statusOf } from '../../core/completions'
import { habitHistory, habitsDue } from '../../core/habits'
import { addDaysToDate, useToday, weekdayOfDate, zoneOf } from '../../core/period'
import { describeRule } from '../../core/recurrence'
import { useStore } from '../../data/store'
import type { Habit } from '../../data/types'
import { Button } from '../../ui/Button'
import { EmptyState, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { DAY_SHORT } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { useOpenParam } from '../useOpenParam'
import { HabitForm } from './HabitForm'
import { HabitRow } from './HabitRow'

const DOT = { done: 'bg-accent', skipped: 'bg-white/25', pending: 'border border-white/20', off: 'bg-transparent' }

function History({ habit, dates, index }: { habit: Habit; dates: string[]; index: ReturnType<typeof indexCompletions> }) {
  const marks = habitHistory(habit, dates, index)
  return (
    <div className="flex gap-1.5" aria-label="Últimos 7 dias">
      {dates.map((d, i) => (
        <span key={d} className="flex w-6 flex-col items-center gap-1">
          <span className={`size-3 rounded-full ${DOT[marks[i]]}`} title={`${d}: ${marks[i] === 'done' ? 'feito' : marks[i] === 'skipped' ? 'pulado' : marks[i] === 'off' ? 'não programado' : 'não feito'}`} />
          <span className="text-[10.5px] text-faint">{DAY_SHORT[weekdayOfDate(d)].slice(0, 1)}</span>
        </span>
      ))}
    </div>
  )
}

export function HabitsPage() {
  const { data, settings } = useStore()
  const form = useSheet<Habit>()
  useOpenParam(data.habits, form.show)
  const today = useToday(zoneOf(settings))
  const index = useMemo(() => indexCompletions(data.completions), [data.completions])
  const due = habitsDue(data.habits, today)
  const week = Array.from({ length: 7 }, (_, i) => addDaysToDate(today, i - 6))
  const active = data.habits.filter((h) => h.active).sort((a, b) => a.name.localeCompare(b.name))
  const inactive = data.habits.filter((h) => !h.active)
  const doneToday = due.filter((h) => statusOf(index, 'habit', h.id, today) === 'done').length

  return (
    <>
      <PageHeader
        title="Hábitos"
        subtitle={due.length ? `${doneToday} de ${due.length} hoje` : undefined}
        actions={
          <Button icon={<Plus size={18} />} onClick={() => form.show()}>
            Novo
          </Button>
        }
      />
      {data.habits.length === 0 ? (
        <EmptyState icon={<Sprout size={22} />} title="Nenhum hábito ainda" text="Água, treino, leitura, sono… Marque um dia de cada vez e acompanhe o histórico." action="Criar hábito" onAction={() => form.show()} />
      ) : (
        <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
          <section>
            <SectionTitle>Hoje</SectionTitle>
            {due.length ? (
              <div className="card p-1.5">
                {due.map((h) => (
                  <HabitRow key={h.id} habit={h} date={today} status={statusOf(index, 'habit', h.id, today)} onOpen={form.show} />
                ))}
              </div>
            ) : (
              <p className="card px-5 py-4 text-[15px] text-faint">Nenhum hábito programado para hoje.</p>
            )}
          </section>
          <section>
            <SectionTitle>Últimos 7 dias</SectionTitle>
            <div className="card divide-y divide-line">
              {active.map((h) => (
                <button key={h.id} type="button" onClick={() => form.show(h)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{h.name}</span>
                    <span className="block truncate text-[13px] text-faint">{[describeRule(h.rule), h.time, h.goal].filter(Boolean).join(' · ')}</span>
                  </span>
                  <History habit={h} dates={week} index={index} />
                </button>
              ))}
            </div>
            {inactive.length > 0 && (
              <>
                <h3 className="mt-6 mb-2 px-1 text-[13px] font-medium tracking-wide text-soft uppercase">Desativados</h3>
                <div className="card divide-y divide-line">
                  {inactive.map((h) => (
                    <button key={h.id} type="button" onClick={() => form.show(h)} className="flex w-full items-center px-4 py-3 text-left text-[15px] text-faint hover:bg-white/[0.03]">
                      {h.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      <HabitForm open={form.open} onClose={form.close} habit={form.item} />
    </>
  )
}
