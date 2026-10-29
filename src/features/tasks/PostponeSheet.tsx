import { CalendarDays, CalendarX2, Sunrise, Sun } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { addDaysToDate, todayIn, weekdayOfDate, zoneOf } from '../../core/period'
import { useDailyActions } from '../../core/actions'
import { useStore } from '../../data/store'
import type { Task } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { useFeedback } from '../../ui/Feedback'
import { Sheet } from '../../ui/Sheet'

function Option({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-tint/[0.04] tap">
      <span className="icon-tile grid size-9 shrink-0 place-items-center rounded-xl">{icon}</span>
      <span className="min-w-0 flex-1 text-[15px] font-medium">{label}</span>
      {hint && <span className="num shrink-0 text-[13px] text-faint">{hint}</span>}
    </button>
  )
}

/** Move a task in one tap: tomorrow, next Monday, a date, or no date. The time of day stays. */
export function PostponeSheet({ task, onClose }: { task: Task | null; onClose(): void }) {
  const { settings } = useStore()
  const { moveTask, clearTaskDate } = useDailyActions()
  const { toast } = useFeedback()
  const [picking, setPicking] = useState('')
  const today = todayIn(zoneOf(settings))
  const monday = addDaysToDate(today, ((8 - weekdayOfDate(today)) % 7) || 7)
  const move = async (date: string) => {
    if (!task) return
    await moveTask(task, date)
    toast(`Movida para ${formatDateValue(date)}`)
    onClose()
  }
  return (
    <Sheet open={!!task} onClose={onClose} title="Adiar tarefa">
      {task && (
        <div className="-mx-2 space-y-0.5">
          <p className="mb-2 px-3 text-[14px] text-soft">{task.title}</p>
          {task.dueDate !== today && <Option icon={<Sun size={18} />} label="Hoje" hint={formatDateValue(today)} onClick={() => move(today)} />}
          <Option icon={<Sunrise size={18} />} label="Amanhã" hint={formatDateValue(addDaysToDate(today, 1))} onClick={() => move(addDaysToDate(today, 1))} />
          <Option icon={<CalendarDays size={18} />} label="Próxima segunda" hint={formatDateValue(monday)} onClick={() => move(monday)} />
          <label className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 hover:bg-tint/[0.04]">
            <span className="icon-tile grid size-9 shrink-0 place-items-center rounded-xl">
              <CalendarDays size={18} />
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-medium">Escolher data</span>
            <input type="date" aria-label="Escolher data" min={today} value={picking} onChange={(e) => setPicking(e.target.value)} className="h-10 w-36 rounded-xl border border-line bg-raised px-2 text-[14px]" />
          </label>
          {picking && (
            <button type="button" onClick={() => move(picking)} className="press mx-3 mt-1 h-11 w-[calc(100%-1.5rem)] rounded-full bg-accent text-[15px] font-semibold text-on-accent">
              Mover para {formatDateValue(picking)}
            </button>
          )}
          {task.dueDate && (
            <Option
              icon={<CalendarX2 size={18} />}
              label="Sem data"
              onClick={async () => {
                await clearTaskDate(task)
                toast('Tarefa sem data')
                onClose()
              }}
            />
          )}
        </div>
      )}
    </Sheet>
  )
}
