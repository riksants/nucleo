/**
 * The details of one thing of the day (Hoje, Agenda), with what can be done right there: conclude, "não fiz",
 * +1 h, amanhã, another date/time — for a recurring item "só esta" or "esta e as próximas". Every action writes
 * to the original record; the full form is one tap away ("Editar").
 */
import { CalendarClock, Check, Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTime, toMinutes } from '../../../supabase/functions/_shared/planner/time.ts'
import { navigate } from '../../app/router'
import { itemLabel, type AgendaItem } from '../../core/agenda'
import type { OccurrenceStatus } from '../../core/completions'
import { dayWords } from '../../core/capture'
import { rescheduleOccurrence, splitRecurring } from '../../core/habits'
import { addDaysToDate, nowIn, useToday, zoneOf } from '../../core/period'
import { describeRule } from '../../core/recurrence'
import { isMarkable, timeState } from '../../core/timeState'
import { toTime } from '../../core/timeline'
import { useStore } from '../../data/store'
import type { RecurringItem } from '../../data/types'
import { useNow } from '../../lib/hooks'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, TextInput } from '../../ui/Field'
import { Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { dotOf, useToggleItem } from '../agenda/AgendaRow'
import { useDailyActions } from '../../core/actions'
import { CheckButton } from './CheckButton'
import { StateChip } from './DayParts'

const plusMinutes = (t: string, min: number) => {
  const m = toMinutes(t) + min
  return m < 24 * 60 ? toTime(m) : null
}

/** Can the date/time of this item be changed from here (the routine is changed in Rotina, meals in Alimentação)? */
function movable(item: AgendaItem) {
  return item.source.kind === 'task' || item.source.kind === 'event' || item.source.kind === 'recurring'
}

export function ItemSheet({ item, open, onClose, onEdit }: { item: AgendaItem | null; open: boolean; onClose(): void; onEdit(item: AgendaItem): void }) {
  const { data, settings, save } = useStore()
  const { toast } = useFeedback()
  const toggle = useToggleItem()
  const { setCompletion } = useDailyActions()
  const tz = zoneOf(settings)
  const today = useToday(tz)
  const nowTime = nowIn(tz, useNow(30_000)).time
  const [picking, setPicking] = useState(false)
  const [scope, setScope] = useState<'one' | 'next'>('one')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  useEffect(() => {
    if (!open || !item) return
    setPicking(false)
    setScope('one')
    setDate(item.date)
    setTime(item.start)
  }, [open, item])
  if (!item) return null

  const src = item.source
  const state = timeState(item, today, nowTime)
  // The current version of linked habits (the item object is a snapshot of when it was opened).
  const habits = (item.habits ?? []).map((h) => ({ habit: h.habit, status: (data.completions.find((c) => c.source === 'habit' && c.sourceId === h.habit.id && c.date === item.date)?.status ?? 'pending') as OccurrenceStatus }))
  const status = src.kind === 'task' ? (data.tasks.find((t) => t.id === src.task.id)?.status === 'done' ? 'done' : 'pending') : item.status

  /** Writes the new date/time to the original record. */
  const move = async (to: { date: string; time: string }, how: 'one' | 'next' = 'one') => {
    if (src.kind === 'task') {
      await save('tasks', { ...src.task, dueDate: to.date, dueTime: to.time })
    } else if (src.kind === 'event') {
      const e = src.event
      const length = isTime(e.end) && isTime(e.start) ? toMinutes(e.end) - toMinutes(e.start) : 60
      const end = isTime(to.time) ? toTime(Math.min(toMinutes(to.time) + Math.max(length, 15), 23 * 60 + 59)) : e.end
      await save('events', { ...e, date: to.date, start: to.time || e.start, end })
    } else if (src.kind === 'recurring') {
      const r = data.recurring.find((x) => x.id === src.item.id) ?? src.item
      if (how === 'one') await save('recurring', rescheduleOccurrence(r, item.date, to, today))
      else {
        const split = splitRecurring(r, item.date, { time: to.time })
        // From the first day: the item itself changes (and loses the single-day times from then on).
        if (!split) await save('recurring', { ...r, time: to.time, times: Object.fromEntries(Object.entries(r.times ?? {}).filter(([d]) => d < item.date)) })
        else {
          await save('recurring', split.ended)
          const next = await save('recurring', split.next as RecurringItem)
          // Habits linked to it follow the continuation (same activity).
          for (const h of data.habits) if (h.link?.kind === 'recurring' && h.link.id === r.id) await save('habits', { ...h, link: { kind: 'recurring', id: next.id } })
        }
      }
    }
    toast(to.date === item.date ? `Novo horário: ${to.time || 'sem horário'}` : `Movido para ${dayWords(to.date, today).toLowerCase()}${to.time ? ` às ${to.time}` : ''}`)
    onClose()
  }

  const later = item.start ? plusMinutes(item.start, 60) : null
  const when = [dayWords(item.date, today), item.start && (item.end ? `${item.start}–${item.end}` : item.start)].filter(Boolean).join(' · ')
  const notes = src.kind === 'task' ? src.task.notes : src.kind === 'event' ? src.event.notes : src.kind === 'recurring' ? src.item.notes : ''

  return (
    <Sheet open={open} onClose={onClose} title={item.title}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[14px] text-soft">
          <span className={`size-2 rounded-full ${dotOf(item)}`} />
          <span>{itemLabel(item)}</span>
          <span className="num">· {when}</span>
          {src.kind === 'recurring' && <span>· {describeRule(src.item.rule)}</span>}
          {src.kind === 'habit' && <span>· {describeRule(src.habit.rule)}</span>}
          <span className="ml-auto">
            <StateChip state={state} />
          </span>
        </div>
        {notes && <p className="rounded-2xl bg-tint/[0.04] px-4 py-3 text-[14px] leading-relaxed whitespace-pre-line text-soft">{notes}</p>}

        {isMarkable(item) && (
          <div className="flex flex-wrap gap-2">
            {status === 'done' ? (
              <Button variant="secondary" onClick={() => (toggle(item, 'pending'), onClose())}>
                Desmarcar
              </Button>
            ) : (
              <Button icon={<Check size={18} strokeWidth={2.6} />} onClick={() => (toggle(item, 'done'), onClose())}>
                Concluí
              </Button>
            )}
            {status !== 'done' && src.kind !== 'task' && item.checkable && (
              <Button variant="secondary" icon={<X size={18} />} onClick={() => (toggle(item, status === 'skipped' ? 'pending' : 'skipped'), onClose())}>
                {status === 'skipped' ? 'Desfazer "não fiz"' : 'Não fiz'}
              </Button>
            )}
          </div>
        )}

        {habits.length > 0 && (
          <section aria-label="Hábitos vinculados">
            <p className="mb-1.5 px-1 text-[13px] font-medium text-soft">Hábito vinculado</p>
            <div className="card p-1">
              {habits.map(({ habit, status: hs }) => (
                <div key={habit.id} className="flex items-center gap-1 px-1">
                  <CheckButton status={hs} onClick={() => setCompletion('habit', habit.id, item.date, hs === 'done' ? null : 'done')} label={hs === 'done' ? `Desmarcar ${habit.name}` : `Concluir ${habit.name}`} />
                  <span className={`min-w-0 flex-1 truncate text-[15px] ${hs === 'done' ? 'text-faint line-through' : ''}`}>{habit.name}</span>
                  <span className="pr-2 text-[12px] text-faint">{habit.autoFromLink ? 'marca junto' : 'pergunta ao concluir'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {movable(item) && status !== 'done' && (
          <section aria-label="Reagendar" className="space-y-3">
            <p className="px-1 text-[13px] font-medium text-soft">Mudar o horário</p>
            <div className="flex flex-wrap gap-2">
              {later && item.date >= today && (
                <button type="button" onClick={() => move({ date: item.date, time: later })} className="press inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                  +1 h · {later}
                </button>
              )}
              <button type="button" onClick={() => move({ date: addDaysToDate(item.date < today ? today : item.date, 1), time: item.start })} className="press inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                {item.date < today ? 'Amanhã' : 'Dia seguinte'}
              </button>
              <button type="button" aria-expanded={picking} onClick={() => setPicking(!picking)} className="press inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                <CalendarClock size={16} /> Outro dia ou horário
              </button>
            </div>
            {picking && (
              <div className="space-y-3 rounded-2xl bg-tint/[0.04] p-3.5">
                {src.kind === 'recurring' && (
                  <Segmented<'one' | 'next'>
                    block
                    size="sm"
                    label="Aplicar a"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: 'one', label: 'Só esta' },
                      { value: 'next', label: 'Esta e as próximas' },
                    ]}
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  {scope === 'one' ? (
                    <Field label="Dia">
                      <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </Field>
                  ) : (
                    <p className="self-end pb-3 text-[13px] text-soft">A partir de {dayWords(item.date, today).toLowerCase()}</p>
                  )}
                  <Field label="Horário">
                    <TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </Field>
                </div>
                <Button block disabled={!date || (src.kind === 'event' && !isTime(time)) || (scope === 'next' && time === item.start)} onClick={() => move({ date: scope === 'next' ? item.date : date, time }, scope)}>
                  Salvar
                </Button>
                {scope === 'next' && <p className="text-[12px] text-faint">Para mudar os dias da semana ou a frequência, use Editar.</p>}
              </div>
            )}
          </section>
        )}

        <div className="flex justify-end border-t border-line pt-3">
          <Button
            variant="ghost"
            icon={<Pencil size={16} />}
            onClick={() => {
              onClose()
              if (src.kind === 'routine') navigate('/routine')
              else if (src.kind === 'meal') navigate('/meals')
              else onEdit(item)
            }}
          >
            {src.kind === 'routine' ? 'Abrir a rotina' : src.kind === 'meal' ? 'Abrir alimentação' : 'Editar'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
