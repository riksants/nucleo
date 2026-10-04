import { useDailyActions } from '../../core/actions'
import type { OccurrenceStatus } from '../../core/completions'
import type { RecurringItem } from '../../data/types'
import { CheckButton } from '../daily/CheckButton'

/** One occurrence (item + date). Its state never affects other dates. */
export function RecurringRow({ item, date, status, onOpen }: { item: RecurringItem; date: string; status: OccurrenceStatus; onOpen?(i: RecurringItem): void }) {
  const { setCompletion } = useDailyActions()
  const toggle = () => setCompletion('recurring', item.id, date, status === 'done' ? null : 'done')
  const skip = () => setCompletion('recurring', item.id, date, status === 'skipped' ? null : 'skipped')
  return (
    <div className="flex items-center gap-1 rounded-2xl px-1 hover:bg-white/[0.03] tap">
      <CheckButton status={status} onClick={toggle} label={status === 'done' ? `Desmarcar ${item.title}` : `Concluir ${item.title}`} />
      <button type="button" onClick={() => onOpen?.(item)} disabled={!onOpen} className="min-w-0 flex-1 py-3 pr-1 text-left">
        <span className={`block truncate text-[15px] ${status === 'done' ? 'text-faint line-through' : status === 'skipped' ? 'text-faint' : ''}`}>{item.title}</span>
        {(item.time || status === 'skipped') && <span className="block truncate text-[13px] text-faint">{status === 'skipped' ? 'Pulado hoje' : item.time}</span>}
      </button>
      {status !== 'done' && (
        <button type="button" onClick={skip} className="shrink-0 rounded-xl px-2.5 py-2 text-[13px] font-medium text-faint hover:bg-white/[0.04] tap hover:text-soft">
          {status === 'skipped' ? 'Desfazer' : 'Pular hoje'}
        </button>
      )}
    </div>
  )
}
