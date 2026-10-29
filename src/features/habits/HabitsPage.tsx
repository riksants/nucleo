import { Flame, Play, Sprout } from 'lucide-react'
import { useMemo } from 'react'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { indexCompletions, statusOf, type CompletionIndex } from '../../core/completions'
import { habitRate } from '../../core/habitProgress'
import { habitHistory, habitsDue } from '../../core/habits'
import { addDaysToDate, nowIn, useToday, weekdayOfDate, zoneOf } from '../../core/period'
import { describeRule } from '../../core/recurrence'
import { occurrenceStreak } from '../../core/streaks'
import { useStore } from '../../data/store'
import type { Habit } from '../../data/types'
import { useNow } from '../../lib/hooks'
import { EmptyState, Progress, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { DAY_SHORT } from '../../../supabase/functions/_shared/planner/schedule.ts'
import { useOpenParam } from '../useOpenParam'
import { HabitForm } from './HabitForm'
import { HabitRow } from './HabitRow'

const CELL = { done: 'bg-accent', skipped: 'bg-tint/20', pending: 'bg-tint/[0.07]', off: 'bg-transparent ring-1 ring-line ring-inset' }

/** The last 14 days as two rows of squares (done / skipped / not done / not scheduled). */
function TwoWeeks({ habit, dates, index }: { habit: Habit; dates: string[]; index: CompletionIndex }) {
  const marks = habitHistory(habit, dates, index)
  return (
    <div className="grid grid-cols-7 gap-1" aria-label="Últimos 14 dias">
      {dates.map((d, i) => (
        <span
          key={d}
          className={`aspect-square rounded-[5px] ${CELL[marks[i]]}`}
          title={`${DAY_SHORT[weekdayOfDate(d)]} ${d.slice(8)}/${d.slice(5, 7)}: ${marks[i] === 'done' ? 'feito' : marks[i] === 'skipped' ? 'pulado' : marks[i] === 'off' ? 'não programado' : 'não feito'}`}
        />
      ))}
    </div>
  )
}

export function HabitsPage() {
  const { data, settings } = useStore()
  const form = useSheet<Habit>()
  useOpenParam(data.habits, form.show)
  const tz = zoneOf(settings)
  const today = useToday(tz)
  const nowTime = nowIn(tz, useNow()).time
  const index = useMemo(() => indexCompletions(data.completions), [data.completions])
  const due = habitsDue(data.habits, today)
  const days14 = Array.from({ length: 14 }, (_, i) => addDaysToDate(today, i - 13))
  const active = data.habits.filter((h) => h.active).sort((a, b) => a.name.localeCompare(b.name))
  const inactive = data.habits.filter((h) => !h.active)
  const doneToday = due.filter((h) => statusOf(index, 'habit', h.id, today) === 'done').length
  const streaks = new Map(active.map((h) => [h.id, occurrenceStreak('habit', h.id, h.rule, h.startDate, index, today).current]))
  const best = Math.max(0, ...streaks.values())
  const rates = new Map(active.map((h) => [h.id, habitRate(h, index, today)]))
  const avg = active.length ? Math.round([...rates.values()].reduce((n, r) => n + r.pct, 0) / active.length) : 0
  // Time passed and not marked yet: a gentle "Confirmar" on the row instead of assuming anything.
  const late = (h: Habit) => h.time && h.time < nowTime && statusOf(index, 'habit', h.id, today) === 'pending'

  return (
    <>
      <PageHeader
        rich
        icon={Sprout}
        eyebrow={due.length ? `${due.length} para hoje` : 'Hábitos'}
        title="Hábitos"
        primary={{ label: 'Novo', aria: 'Novo hábito', onPress: () => form.show() }}
        stats={
          data.habits.length
            ? [
                { label: 'Hoje', value: due.length ? `${doneToday}/${due.length}` : '—' },
                { label: 'Maior sequência', value: best ? `${best} ${best === 1 ? 'dia' : 'dias'}` : '—' },
                { label: 'Em 30 dias', value: `${avg}%` },
              ]
            : undefined
        }
      />
      {data.habits.length === 0 ? (
        <EmptyState icon={<Sprout size={20} />} title="Nenhum hábito ainda" text="Água, treino, estudo, leitura… Com horário, o hábito entra no seu dia e nos lembretes. Com duração, o cronômetro marca o dia sozinho." action="Criar hábito" onAction={() => form.show()} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-7 lg:grid-cols-2 lg:items-start">
          <section>
            <SectionTitle>Hoje</SectionTitle>
            {due.length ? (
              <>
                <div className="mb-3 flex items-center gap-3 px-1">
                  <div className="min-w-0 flex-1">
                    <Progress value={(doneToday / due.length) * 100} tone="accent" />
                  </div>
                  <span className="num shrink-0 text-[13px] font-medium text-soft">
                    {doneToday} de {due.length}
                  </span>
                </div>
                <div className="card p-1.5">
                  {due.map((h) => {
                    const status = statusOf(index, 'habit', h.id, today)
                    return (
                      <div key={h.id} className="flex items-center">
                        <div className="min-w-0 flex-1">
                          <HabitRow habit={h} date={today} status={status} onOpen={form.show} hint={late(h) ? `Era às ${h.time} · confirme` : undefined} />
                        </div>
                        {h.minutes && status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => navigate('/focus', { habit: h.id })}
                            aria-label={`Iniciar sessão de ${h.name}`}
                            className="press mr-1 inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-accent/[0.12] px-3 text-[13px] font-semibold text-accent-hi hover:bg-accent/[0.2]"
                          >
                            <Play size={14} /> {h.minutes} min
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="card px-5 py-4 text-[15px] text-faint">Nenhum hábito programado para hoje.</p>
            )}
          </section>
          <section>
            <SectionTitle>Evolução</SectionTitle>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {active.map((h) => {
                const streak = streaks.get(h.id) ?? 0
                const rate = rates.get(h.id)!
                return (
                  <button key={h.id} type="button" onClick={() => form.show(h)} className="card p-4 text-left transition-colors hover:border-line-strong">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{h.name}</span>
                        <span className="block truncate text-[12px] text-faint">{[describeRule(h.rule), h.time, h.minutes ? `${h.minutes} min` : h.goal].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold ${streak ? 'text-accent-hi' : 'text-faint'}`} aria-label={`Sequência de ${streak} dias`}>
                        <Flame size={16} /> {streak}
                      </span>
                    </div>
                    <div className="mt-3 flex items-end gap-4">
                      <div className="min-w-0 flex-1">
                        <TwoWeeks habit={h} dates={days14} index={index} />
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="num text-[20px] leading-none font-semibold tracking-[-0.03em]">{rate.pct}%</p>
                        <p className="mt-1 text-[11px] text-faint">{rate.expected ? `${rate.done} de ${rate.expected} · 30 dias` : 'começando'}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            {inactive.length > 0 && (
              <>
                <h3 className="mt-6 mb-2 px-1 text-[13px] font-semibold text-soft">Desativados</h3>
                <div className="card divide-y divide-line">
                  {inactive.map((h) => (
                    <button key={h.id} type="button" onClick={() => form.show(h)} className="flex w-full items-center px-4 py-3 text-left text-[15px] text-faint hover:bg-tint/[0.03] tap">
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
