import { ChevronDown, Flame, Link2, Play, Sprout } from 'lucide-react'
import { useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { indexCompletions, statusOf, type CompletionIndex } from '../../core/completions'
import { habitRate } from '../../core/habitProgress'
import { linkLabel } from '../../core/habitLink'
import { habitHistory, habitsDue } from '../../core/habits'
import { nowIn, useToday, weekDates, zoneOf } from '../../core/period'
import { describeRule } from '../../core/recurrence'
import { occurrenceStreak } from '../../core/streaks'
import { useStore } from '../../data/store'
import type { Habit } from '../../data/types'
import { useNow } from '../../lib/hooks'
import { EmptyState, Progress, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { useOpenParam } from '../useOpenParam'
import { HabitForm } from './HabitForm'
import { HabitRow } from './HabitRow'

const LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const DOT = { done: 'bg-accent', skipped: 'bg-tint/25', pending: 'bg-transparent ring-1 ring-line-strong ring-inset', off: 'bg-tint/[0.06]' }

/** This week (Mon–Sun) as seven small marks: done · skipped · open · not scheduled. Days ahead stay open. */
function Week({ habit, dates, index, today }: { habit: Habit; dates: string[]; index: CompletionIndex; today: string }) {
  const marks = habitHistory(habit, dates, index)
  return (
    <div className="flex gap-1" aria-label="Esta semana">
      {dates.map((d, i) => (
        <span key={d} className="flex w-4 flex-col items-center gap-1">
          <span className={`text-[10px] leading-none font-semibold ${d === today ? 'text-accent-hi' : 'text-faint'}`}>{LETTER[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
          <span
            className={`size-3 rounded-full ${DOT[marks[i]]} ${d > today && marks[i] === 'pending' ? 'opacity-50' : ''}`}
            title={`${d.slice(8)}/${d.slice(5, 7)}: ${marks[i] === 'done' ? 'feito' : marks[i] === 'skipped' ? 'pulado' : marks[i] === 'off' ? 'não programado' : d > today ? 'ainda vem' : 'não marcado'}`}
          />
        </span>
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
  const [showInactive, setShowInactive] = useState(false)
  const index = useMemo(() => indexCompletions(data.completions), [data.completions])
  const due = habitsDue(data.habits, today)
  const week = weekDates(today)
  const active = data.habits.filter((h) => h.active).sort((a, b) => a.name.localeCompare(b.name))
  const inactive = data.habits.filter((h) => !h.active)
  const statusToday = (h: Habit) => statusOf(index, 'habit', h.id, today)
  const open = due.filter((h) => statusToday(h) === 'pending')
  const closed = due.filter((h) => statusToday(h) !== 'pending')
  const doneToday = due.filter((h) => statusToday(h) === 'done').length
  const streaks = new Map(active.map((h) => [h.id, occurrenceStreak('habit', h.id, h.rule, h.startDate, index, today).current]))
  const best = Math.max(0, ...streaks.values())
  const rates = new Map(active.map((h) => [h.id, habitRate(h, index, today)]))
  const avg = active.length ? Math.round([...rates.values()].reduce((n, r) => n + r.pct, 0) / active.length) : 0
  // Time passed and not marked yet: a gentle "confirme" on the row instead of assuming anything.
  const late = (h: Habit) => h.time && h.time < nowTime && statusToday(h) === 'pending'

  const row = (h: Habit) => {
    const status = statusToday(h)
    const hint = late(h) ? `Era às ${h.time} · confirme` : h.link ? `${[h.time, h.minutes ? `${h.minutes} min` : ''].filter(Boolean).join(' · ')}${h.time || h.minutes ? ' · ' : ''}com ${linkLabel(data, h.link)}` : undefined
    return (
      <div key={h.id} className="flex items-center">
        <div className="min-w-0 flex-1">
          <HabitRow habit={h} date={today} status={status} onOpen={form.show} hint={hint} />
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
  }

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
        <EmptyState icon={<Sprout size={20} />} title="Nenhum hábito ainda" text="Água, treino, estudo, leitura… Com horário, o hábito entra no seu dia. Com duração, o cronômetro marca o dia sozinho." action="Criar hábito" onAction={() => form.show()} />
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
                {/* Still to do first, then what was already marked today (muted, can be undone). */}
                <div className="card p-1.5">
                  {open.map(row)}
                  {open.length === 0 && <p className="px-3.5 py-3 text-[15px] font-medium">Tudo marcado por hoje.</p>}
                  {closed.length > 0 && open.length > 0 && <p className="mt-1 border-t border-line px-3.5 pt-2.5 pb-1 text-[12px] font-semibold text-faint">Marcados hoje</p>}
                  {closed.map(row)}
                </div>
              </>
            ) : (
              <p className="card px-5 py-4 text-[15px] text-faint">Nenhum hábito programado para hoje.</p>
            )}
          </section>
          <section>
            <SectionTitle>Esta semana</SectionTitle>
            <div className="card divide-y divide-line">
              {active.map((h) => {
                const streak = streaks.get(h.id) ?? 0
                const rate = rates.get(h.id)!
                return (
                  <button key={h.id} type="button" onClick={() => form.show(h)} className="block w-full px-4 py-3 text-left hover:bg-tint/[0.03] tap">
                    <span className="flex items-center gap-2">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-medium">
                        <span className="truncate">{h.name}</span>
                        {h.link && <Link2 size={14} className="shrink-0 text-faint" aria-label="Vinculado" />}
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold ${streak ? 'text-accent-hi' : 'text-faint'}`} aria-label={`Sequência de ${streak} ${streak === 1 ? 'dia' : 'dias'}`}>
                        <Flame size={14} /> {streak}
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-end gap-3">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{[describeRule(h.rule), h.time, rate.expected ? `${rate.pct}% em 30 dias` : 'começando'].filter(Boolean).join(' · ')}</span>
                      <Week habit={h} dates={week} index={index} today={today} />
                    </span>
                  </button>
                )
              })}
            </div>
            {inactive.length > 0 && (
              <div className="mt-5">
                <button type="button" aria-expanded={showInactive} onClick={() => setShowInactive(!showInactive)} className="flex w-full items-center gap-2 px-1 text-[13px] font-semibold text-soft hover:text-ink">
                  Desativados · {inactive.length}
                  <ChevronDown size={16} className={`transition-transform duration-200 ${showInactive ? 'rotate-180' : ''}`} />
                </button>
                {showInactive && (
                  <div className="card mt-2 divide-y divide-line">
                    {inactive.map((h) => (
                      <button key={h.id} type="button" onClick={() => form.show(h)} className="flex w-full items-center px-4 py-3 text-left text-[15px] text-faint hover:bg-tint/[0.03] tap">
                        {h.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      <HabitForm open={form.open} onClose={form.close} habit={form.item} />
    </>
  )
}
