import { Flame, Plus, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { goalWeekStreak } from '../../core/goalStreak'
import type { RangeMetrics } from '../../core/metrics'
import { addDaysToDate } from '../../core/period'
import { goalProgress } from '../../core/weekGoals'
import { useStore } from '../../data/store'
import type { WeekId, WeeklyGoal } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { Button } from '../../ui/Button'
import { Badge, Progress, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { GoalForm } from './GoalForm'

export function formatGoalValue(goal: WeeklyGoal, value: number, currency: string): string {
  if (goal.kind === 'money') return formatMoney(value, currency)
  if (goal.kind === 'percent') return `${value}%`
  return String(value)
}

/** Weekly goals with progress computed from real data (manual ones excepted). */
export function GoalsSection({ week, currentWeek, metrics, editable = true }: { week: WeekId; currentWeek: WeekId; metrics: RangeMetrics; editable?: boolean }) {
  const { data, settings, save } = useStore()
  const { toast } = useFeedback()
  const form = useSheet<WeeklyGoal>()
  const actions = useSheet<WeeklyGoal>()
  const [showArchived, setShowArchived] = useState(false)
  const all = data.weeklyGoals.filter((g) => g.week === week)
  const goals = all.filter((g) => g.status !== 'archived')
  const archived = all.filter((g) => g.status === 'archived')
  const streaks = useMemo(() => Object.fromEntries(goals.map((g) => [g.id, goalWeekStreak(data, settings, g)])), [goals, data, settings])
  const cur = settings.baseCurrency

  const repeat = async (g: WeeklyGoal) => {
    const next = addDaysToDate(g.week, 7)
    if (data.weeklyGoals.some((x) => x.repeatKey === g.repeatKey && x.week === next)) {
      toast('Essa meta já está na próxima semana')
      return
    }
    // Same repeatKey: the weeks are linked for the "weeks in a row" streak.
    await save('weeklyGoals', { week: next, title: g.title, kind: g.kind, metric: g.metric, target: g.target, manualValue: 0, status: 'active', repeatKey: g.repeatKey })
    toast('Repetida na próxima semana')
  }

  const item = actions.item
  const p = item ? goalProgress(item, metrics) : null

  return (
    <section>
      <SectionTitle action={editable ? 'Nova meta' : undefined} onAction={() => form.show()}>
        Metas da semana
      </SectionTitle>
      {goals.length ? (
        <div className="card divide-y divide-line">
          {goals.map((g) => {
            const gp = goalProgress(g, metrics)
            return (
              <button key={g.id} type="button" onClick={() => actions.show(g)} className="block w-full px-4 py-3.5 text-left hover:bg-white/[0.03] tap">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{g.title}</span>
                  {gp.achieved ? <Badge tone="positive">Cumprida</Badge> : <span className="num shrink-0 text-[14px] text-soft">{gp.noData ? 'sem dados ainda' : `${formatGoalValue(g, gp.value, cur)} / ${formatGoalValue(g, gp.target, cur)}`}</span>}
                </span>
                <span className="mt-2 block">
                  <Progress value={gp.percent} tone={gp.achieved ? 'positive' : 'accent'} />
                </span>
                <span className="mt-1.5 flex items-center gap-2 text-[13px] text-faint">
                  {gp.auto ? 'Atualiza sozinha' : 'Manual'}
                  {(streaks[g.id] ?? 0) >= 2 && (
                    <span className="inline-flex items-center gap-1 text-warn">
                      <Flame size={13} /> {streaks[g.id]} semanas seguidas
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="card flex items-center justify-between gap-3 px-5 py-4">
          <span className="flex items-center gap-2 text-[15px] text-faint">
            <Target size={17} /> Nenhuma meta para esta semana
          </span>
          {editable && (
            <button type="button" onClick={() => form.show()} className="hit relative shrink-0 text-sm font-medium text-accent-hi hover:text-ink">
              Criar
            </button>
          )}
        </div>
      )}
      {archived.length > 0 && (
        <button type="button" onClick={() => setShowArchived(!showArchived)} className="mt-2 px-1 text-[13px] text-faint hover:text-soft">
          {showArchived ? 'Esconder arquivadas' : `${archived.length} arquivada${archived.length > 1 ? 's' : ''}`}
        </button>
      )}
      {showArchived && (
        <div className="card mt-2 divide-y divide-line">
          {archived.map((g) => (
            <button key={g.id} type="button" onClick={() => actions.show(g)} className="block w-full px-4 py-3 text-left text-[15px] text-faint hover:bg-white/[0.03] tap">
              {g.title}
            </button>
          ))}
        </div>
      )}

      <Sheet open={actions.open} onClose={actions.close} title={item?.title}>
        {item && p && (
          <div className="space-y-4">
            <div>
              <p className="num text-[24px] font-semibold">
                {p.noData ? 'Sem dados ainda' : `${formatGoalValue(item, p.value, cur)} de ${formatGoalValue(item, p.target, cur)}`}
              </p>
              <p className="text-[13px] text-faint">{p.auto ? 'Calculado com o que você já registrou no NÚCLEO.' : 'Meta manual: você atualiza o valor.'}</p>
            </div>
            {item.kind === 'manual' && item.status !== 'archived' && (
              <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={() => save('weeklyGoals', { ...item, manualValue: Math.max(0, item.manualValue - 1) }).then((g) => actions.show(g))}>
                  −1
                </Button>
                <span className="num min-w-10 text-center text-[18px] font-semibold">{item.manualValue}</span>
                <Button variant="secondary" icon={<Plus size={16} />} onClick={() => save('weeklyGoals', { ...item, manualValue: item.manualValue + 1 }).then((g) => actions.show(g))}>
                  1
                </Button>
              </div>
            )}
            <div className="card divide-y divide-line overflow-hidden">
              {item.status !== 'archived' && (
                <button type="button" className="block w-full px-4 py-3.5 text-left text-[15px] hover:bg-white/[0.03] tap" onClick={async () => (await save('weeklyGoals', { ...item, status: item.status === 'done' ? 'active' : 'done' }), actions.close(), toast(item.status === 'done' ? 'Meta reaberta' : 'Meta concluída'))}>
                  {item.status === 'done' ? 'Reabrir' : 'Marcar como concluída'}
                </button>
              )}
              <button type="button" className="block w-full px-4 py-3.5 text-left text-[15px] hover:bg-white/[0.03] tap" onClick={async () => (await repeat(item), actions.close())}>
                Repetir na próxima semana
              </button>
              <button type="button" className="block w-full px-4 py-3.5 text-left text-[15px] hover:bg-white/[0.03] tap" onClick={() => (actions.close(), form.show(item))}>
                Editar ou excluir
              </button>
              <button type="button" className="block w-full px-4 py-3.5 text-left text-[15px] text-soft hover:bg-white/[0.03] tap" onClick={async () => (await save('weeklyGoals', { ...item, status: item.status === 'archived' ? 'active' : 'archived' }), actions.close(), toast(item.status === 'archived' ? 'Meta restaurada' : 'Meta arquivada'))}>
                {item.status === 'archived' ? 'Restaurar' : 'Arquivar'}
              </button>
            </div>
          </div>
        )}
      </Sheet>
      <GoalForm open={form.open} onClose={form.close} goal={form.item} defaultWeek={week} currentWeek={currentWeek} />
    </section>
  )
}
