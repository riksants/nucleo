import { useDailyActions } from '../../core/actions'
import { useStore } from '../../data/store'
import { useFeedback } from '../../ui/Feedback'
import { itemLabel, type AgendaItem } from '../../core/agenda'
import { CheckButton } from '../daily/CheckButton'

export const DOT: Record<string, string> = {
  event: 'bg-accent-hi',
  task: 'bg-soft',
  habit: 'bg-income',
  recurring: 'bg-warn',
  meal: 'bg-warn',
  work: 'bg-accent',
  study: 'bg-goal',
  training: 'bg-income',
  commute: 'bg-tint/30',
  rest: 'bg-tint/30',
  activity: 'bg-accent-hi',
  other: 'bg-faint',
}

/** Toggles done on the original record (task, completion of the day, routine block). */
/** The color dot of an item: its kind, or the kind of routine block. */
export function dotOf(item: AgendaItem): string {
  return DOT[item.kind === 'routine' ? (item.blockKind ?? 'other') : item.kind]
}

export function useToggleItem() {
  const { completeTask, setCompletion, setRoutine, setMealDone } = useDailyActions()
  const { data } = useStore()
  const { toast } = useFeedback()

  /**
   * Habits attached to the line (linked to this recurring item or routine block). Done → marked too when the
   * person chose "automático", otherwise offered in one tap. Undone → only what was marked together goes back.
   */
  const linked = async (item: AgendaItem, to: 'done' | 'pending' | 'skipped') => {
    const habits = item.habits ?? []
    if (!habits.length) return
    if (to === 'pending') {
      for (const { habit } of habits) {
        const c = data.completions.find((x) => x.source === 'habit' && x.sourceId === habit.id && x.date === item.date)
        if (c?.via === item.key) await setCompletion('habit', habit.id, item.date, null)
      }
      return
    }
    if (to !== 'done') return
    const open = habits.filter((h) => h.status === 'pending').map((h) => h.habit)
    const auto = open.filter((h) => h.autoFromLink)
    const ask = open.filter((h) => !h.autoFromLink)
    for (const h of auto) await setCompletion('habit', h.id, item.date, 'done', item.key)
    if (ask.length)
      toast(`${item.title}: concluído`, 'success', {
        label: ask.length === 1 ? `Marcar ${ask[0].name}` : 'Marcar hábitos',
        run: () => void Promise.all(ask.map((h) => setCompletion('habit', h.id, item.date, 'done', item.key))),
      })
    else if (auto.length) toast(`${item.title} e ${auto.map((h) => h.name).join(', ')}: concluídos`)
  }

  return async (item: AgendaItem, to: 'done' | 'pending' | 'skipped' = item.status === 'done' ? 'pending' : 'done') => {
    const src = item.source
    if (src.kind === 'task') return completeTask(src.task, to === 'done')
    if (src.kind === 'mealEntry') return setMealDone(src.meal, to === 'done')
    if (src.kind === 'habit') return setCompletion('habit', src.habit.id, item.date, to === 'pending' ? null : to)
    if (src.kind === 'recurring') await setCompletion('recurring', src.item.id, item.date, to === 'pending' ? null : to)
    else if (src.kind === 'routine') await (to === 'skipped' ? setCompletion('routine', src.block.id, item.date, 'skipped') : setRoutine(src.plan, src.block.id, item.date, to === 'done'))
    else return
    await linked(item, to)
  }
}

export function AgendaRow({ item, onOpen, showLabel = true, readOnly }: { item: AgendaItem; onOpen(item: AgendaItem): void; showLabel?: boolean; readOnly?: boolean }) {
  const toggle = useToggleItem()
  const dot = DOT[item.kind === 'routine' ? (item.blockKind ?? 'other') : item.kind]
  const muted = item.status === 'done' || item.status === 'skipped'
  return (
    <div className="flex items-center gap-1 rounded-2xl px-1 hover:bg-tint/[0.03] tap">
      {(item.checkable || item.markable) && !readOnly ? (
        <CheckButton status={item.status === 'ended' ? 'pending' : item.status} onClick={() => toggle(item)} label={item.status === 'done' ? `Desmarcar ${item.title}` : `Concluir ${item.title}`} />
      ) : (
        <span className="grid size-12 shrink-0 place-items-center">
          <span className={`size-2.5 rounded-full ${dot}`} />
        </span>
      )}
      <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 text-left">
        {item.start && <span className="num w-[52px] shrink-0 text-[14px] text-soft">{item.start}</span>}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${muted ? 'text-faint' : ''} ${item.status === 'done' ? 'line-through' : ''}`}>{item.title}</span>
          {showLabel && (
            <span className="flex items-center gap-1.5 text-[13px] text-faint">
              {(item.checkable || item.markable) && <span className={`size-1.5 rounded-full ${dot}`} />}
              {itemLabel(item)}
              {item.end && item.kind === 'event' ? ` · até ${item.end}` : ''}
              {item.status === 'ended' && ' · horário encerrado'}
              {item.status === 'skipped' && ' · pulado'}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}
