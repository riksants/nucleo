import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { addMonthsTo, monthLabel, monthOf, type MonthId } from '../../core/finance'
import { calendarMonth, dayIndicators, type CalendarMark, type IndicatorTone } from '../../core/lifeCalendar'
import { useToday, weekdayOfDate, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { formatDateValue } from '../../lib/dates'
import { Button, IconButton } from '../../ui/Button'
import { AgendaRow } from '../agenda/AgendaRow'
import { useOpenItem } from '../agenda/openItem'

const WEEKDAYS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']
const WEEKDAYS_LONG = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
/** Existing palette, one discreet dot per type. */
const TONE_DOT: Record<IndicatorTone, string> = { event: 'bg-accent-hi', task: 'bg-soft', training: 'bg-income', money: 'bg-warn', deadline: 'bg-goal' }
const MARK_DOT: Record<CalendarMark['type'], string> = { plan: 'bg-goal', step: 'bg-goal', workProject: 'bg-accent', financeGoal: 'bg-goal', tool: 'bg-warn' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Opens the original record behind a deadline/charge. */
function openMark(m: CalendarMark) {
  const r = m.ref
  if (r.kind === 'plan') navigate('/life', { view: r.plan.kind === 'objective' ? 'objectives' : 'projects', open: r.plan.id })
  else if (r.kind === 'step') navigate('/life', { view: r.plan.kind === 'objective' ? 'objectives' : 'projects', open: r.plan.id })
  else if (r.kind === 'workProject') navigate('/projects', { open: r.project.id })
  else if (r.kind === 'financeGoal') navigate('/finance')
  else navigate('/tools', { open: r.tool.id })
}

/**
 * Calendário de Vida: month grid with short indicators; tapping a day lists
 * its items, each one opening (and editing) its original record.
 */
export function LifeCalendar() {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  const [month, setMonth] = useState<MonthId>(monthOf(today))
  const [selected, setSelected] = useState(today)
  const { open, sheets } = useOpenItem()
  // Only the weeks on screen are computed, once per month shown (and when records change).
  const cal = useMemo(() => calendarMonth(data, settings, month), [data, settings, month, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (n: number) => {
    const m = addMonthsTo(month, n)
    setMonth(m)
    setSelected(m === monthOf(today) ? today : `${m}-01`)
  }
  const dayItems = cal.items.get(selected) ?? []
  const dayMarks = cal.marks.get(selected) ?? []

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      <section className="card p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-1 px-1">
          <h2 className="min-w-0 flex-1 text-[17px] font-semibold">
            {cap(monthLabel(month))} <span className="font-normal text-faint">{month.slice(0, 4)}</span>
          </h2>
          {(month !== monthOf(today) || selected !== today) && (
            <Button
              variant="ghost"
              className="h-9! px-3!"
              onClick={() => {
                setMonth(monthOf(today))
                setSelected(today)
              }}
            >
              Hoje
            </Button>
          )}
          <IconButton label="Mês anterior" size="sm" onClick={() => go(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Próximo mês" size="sm" onClick={() => go(1)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11.5px] font-medium text-faint" aria-hidden>
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="py-1">
              <span className="sm:hidden">{w}</span>
              <span className="hidden sm:inline">{WEEKDAYS_LONG[i]}</span>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`${cap(monthLabel(month))} ${month.slice(0, 4)}`}>
          {cal.dates.map((d) => {
            const inMonth = d.slice(0, 7) === month
            const ind = dayIndicators(cal.items.get(d) ?? [], cal.marks.get(d) ?? [])
            const isToday = d === today
            const isSel = d === selected
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-selected={isSel}
                aria-label={`${formatDateValue(d)}${ind.length ? ': ' + ind.map((x) => x.label).join(', ') : ''}`}
                onClick={() => setSelected(d)}
                className={`flex min-h-14 min-w-0 flex-col items-stretch rounded-xl border p-1 text-left transition-colors sm:min-h-20 sm:p-1.5 ${isSel ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:bg-white/[0.04] tap'} ${inMonth ? '' : 'opacity-40'}`}
              >
                <span className={`num grid size-6 place-items-center self-center rounded-full text-[13px] sm:self-start ${isToday ? 'bg-accent font-semibold text-white' : ''}`}>{Number(d.slice(8, 10))}</span>
                {/* Phone: dots. Wider screens: short labels. */}
                <span className="mt-1 flex flex-wrap justify-center gap-0.5 sm:hidden">
                  {ind.slice(0, 4).map((x) => (
                    <span key={x.tone} className={`size-1.5 rounded-full ${TONE_DOT[x.tone]}`} />
                  ))}
                </span>
                <span className="mt-0.5 hidden min-w-0 space-y-px sm:block">
                  {ind.slice(0, 3).map((x) => (
                    <span key={x.tone} className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-soft">
                      <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[x.tone]}`} />
                      <span className="truncate">{x.label}</span>
                    </span>
                  ))}
                  {ind.length > 3 && <span className="block text-[11px] text-faint">+{ind.length - 3}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section aria-live="polite">
        <h3 className="mb-2 px-1 text-[13px] font-medium tracking-wide text-soft uppercase">
          {selected === today ? 'Hoje · ' : ''}
          {WEEKDAYS_LONG[(weekdayOfDate(selected) + 6) % 7]}, {Number(selected.slice(8, 10))} de {monthLabel(selected.slice(0, 7))}
        </h3>
        {dayItems.length || dayMarks.length ? (
          <div className="card p-1.5">
            {dayMarks.map((m) => (
              <button key={m.key} type="button" onClick={() => openMark(m)} className="flex w-full items-center gap-1 rounded-2xl px-1 text-left hover:bg-white/[0.03] tap">
                <span className="grid size-12 shrink-0 place-items-center">
                  <span className={`size-2.5 rounded-full ${MARK_DOT[m.type]}`} />
                </span>
                <span className="min-w-0 flex-1 py-2.5 pr-2">
                  <span className="block truncate text-[15px]">{m.title}</span>
                  <span className="block truncate text-[12.5px] text-faint">{m.label}</span>
                </span>
              </button>
            ))}
            {dayItems.map((i) => (
              <AgendaRow key={i.key} item={i} onOpen={open} />
            ))}
          </div>
        ) : (
          <p className="card px-5 py-4 text-[15px] text-faint">Nada marcado para este dia.</p>
        )}
      </section>
      {sheets}
    </div>
  )
}
