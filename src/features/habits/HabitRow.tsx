import { useDailyActions } from '../../core/actions'
import type { OccurrenceStatus } from '../../core/completions'
import type { Habit } from '../../data/types'
import { CheckButton } from '../daily/CheckButton'

/**
 * A habit on a given day. Marking writes one completion for that day; "Pular hoje"
 * records it as skipped (never as done). Used in Hábitos, Manhã, Noite and Agenda.
 */
export function HabitRow({ habit, date, status, onOpen, compact }: { habit: Habit; date: string; status: OccurrenceStatus; onOpen?(h: Habit): void; compact?: boolean }) {
  const { setCompletion } = useDailyActions()
  const toggle = () => setCompletion('habit', habit.id, date, status === 'done' ? null : 'done')
  const skip = () => setCompletion('habit', habit.id, date, status === 'skipped' ? null : 'skipped')
  const meta = [habit.time, habit.goal].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-1 rounded-2xl px-1 hover:bg-tint/[0.03] tap">
      <CheckButton status={status} onClick={toggle} label={status === 'done' ? `Desmarcar ${habit.name}` : `Concluir ${habit.name}`} />
      <button type="button" onClick={() => onOpen?.(habit)} disabled={!onOpen} className="min-w-0 flex-1 py-3 pr-1 text-left">
        <span className={`block truncate text-[15px] ${status === 'done' ? 'text-faint line-through' : status === 'skipped' ? 'text-faint' : ''}`}>{habit.name}</span>
        {(meta || status === 'skipped') && !compact && (
          <span className="block truncate text-[13px] text-faint">{status === 'skipped' ? 'Pulado hoje' : meta}</span>
        )}
      </button>
      {status !== 'done' && (
        <button type="button" onClick={skip} className="shrink-0 rounded-xl px-2.5 py-2 text-[13px] font-medium text-faint hover:bg-tint/[0.04] tap hover:text-soft">
          {status === 'skipped' ? 'Desfazer' : 'Pular hoje'}
        </button>
      )}
    </div>
  )
}
