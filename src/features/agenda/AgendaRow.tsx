import { useDailyActions } from '../../core/actions'
import { itemLabel, type AgendaItem } from '../../core/agenda'
import { CheckButton } from '../daily/CheckButton'

const DOT: Record<string, string> = {
  event: 'bg-accent-hi',
  task: 'bg-soft',
  habit: 'bg-income',
  recurring: 'bg-warn',
  meal: 'bg-warn',
  work: 'bg-accent',
  study: 'bg-goal',
  training: 'bg-income',
  commute: 'bg-white/30',
  rest: 'bg-white/30',
  activity: 'bg-accent-hi',
  other: 'bg-faint',
}

/** Toggles done on the original record (task, completion of the day, routine block). */
export function useToggleItem() {
  const { completeTask, setCompletion, setRoutine } = useDailyActions()
  return (item: AgendaItem, to: 'done' | 'pending' | 'skipped' = item.status === 'done' ? 'pending' : 'done') => {
    const src = item.source
    if (src.kind === 'task') return completeTask(src.task, to === 'done')
    if (src.kind === 'habit') return setCompletion('habit', src.habit.id, item.date, to === 'pending' ? null : to)
    if (src.kind === 'recurring') return setCompletion('recurring', src.item.id, item.date, to === 'pending' ? null : to)
    if (src.kind === 'routine') return to === 'skipped' ? setCompletion('routine', src.block.id, item.date, 'skipped') : setRoutine(src.plan, src.block.id, item.date, to === 'done')
  }
}

export function AgendaRow({ item, onOpen, showLabel = true, readOnly }: { item: AgendaItem; onOpen(item: AgendaItem): void; showLabel?: boolean; readOnly?: boolean }) {
  const toggle = useToggleItem()
  const dot = DOT[item.kind === 'routine' ? (item.blockKind ?? 'other') : item.kind]
  const muted = item.status === 'done' || item.status === 'skipped'
  return (
    <div className="flex items-center gap-1 rounded-2xl px-1 hover:bg-white/[0.03]">
      {item.checkable && !readOnly ? (
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
            <span className="flex items-center gap-1.5 text-[12.5px] text-faint">
              {item.checkable && <span className={`size-1.5 rounded-full ${dot}`} />}
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
