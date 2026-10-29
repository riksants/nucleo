import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { buildAgenda, itemLabel, type AgendaItem } from '../../core/agenda'
import { moneyDueOn, type MoneyDue } from '../../core/day'
import { addDaysToDate, nowIn, useToday, weekDates, zoneOf } from '../../core/period'
import { timeState, TIME_STATE_LABEL } from '../../core/timeState'
import { useStore } from '../../data/store'
import type { CalendarEvent } from '../../data/types'
import { useNow } from '../../lib/hooks'
import { formatMoney } from '../../lib/money'
import { IconButton } from '../../ui/Button'
import { useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { DayTimeline } from '../daily/DayParts'
import { useOpenParam } from '../useOpenParam'
import { dotOf } from './AgendaRow'
import { EventForm } from './EventForm'
import { useOpenItem } from './openItem'

const LONG = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const SHORT_DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const at = (date: string) => new Date(`${date}T12:00:00Z`)
const dayTitle = (date: string) => LONG.format(at(date))

/** The week as seven tappable days: weekday, number and a dot per kind of thing on it. Today is ringed. */
function WeekStrip({ days, selected, today, items, money, onPick }: { days: string[]; selected: string; today: string; items: AgendaItem[]; money: Map<string, MoneyDue[]>; onPick(d: string): void }) {
  return (
    <div role="tablist" aria-label="Dias da semana" className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const on = d === selected
        const its = items.filter((i) => i.date === d)
        const dots = [...new Set(its.map(dotOf))].slice(0, 3)
        const hasMoney = (money.get(d)?.length ?? 0) > 0
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={`${dayTitle(d)}${its.length ? `, ${its.length} ${its.length === 1 ? 'item' : 'itens'}` : ''}`}
            onClick={() => onPick(d)}
            className={`press flex min-w-0 flex-col items-center gap-1 rounded-2xl py-2 transition-colors ${on ? 'bg-accent text-on-accent' : d === today ? 'bg-accent/[0.1] text-accent-hi ring-1 ring-accent/30 ring-inset' : 'text-soft hover:bg-tint/[0.04]'}`}
          >
            <span className="text-[11px] font-semibold tracking-wide uppercase">{SHORT_DAY.format(at(d)).replace('.', '').slice(0, 3)}</span>
            <span className={`num text-[18px] leading-none font-semibold ${on ? '' : 'text-ink'}`}>{Number(d.slice(8))}</span>
            <span className="flex h-1.5 items-center gap-0.5">
              {dots.map((c) => (
                <span key={c} className={`size-1.5 rounded-full ${on ? 'bg-on-accent' : c}`} />
              ))}
              {hasMoney && <span className={`size-1.5 rounded-full ${on ? 'bg-on-accent' : 'bg-expense'}`} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Bills and charges of a day, shown as financial appointments (computed from the original records). */
function MoneyList({ list }: { list: MoneyDue[] }) {
  if (!list.length) return null
  return (
    <section aria-label="Cobranças e pagamentos">
      <h3 className="mb-2 px-1 text-[13px] font-semibold text-soft">Cobranças e pagamentos</h3>
      <ul className="card p-1.5">
        {list.map((m) => (
          <li key={m.key}>
            <button type="button" onClick={() => navigate(m.path, { open: m.id })} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-tint/[0.03] tap">
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${m.direction === 'pay' ? 'bg-expense/[0.12] text-expense' : 'bg-income/[0.12] text-income'}`}>
                {m.direction === 'pay' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{m.title}</span>
                <span className="block truncate text-[12px] text-faint">{m.direction === 'pay' ? 'Você paga' : 'Você recebe'} · {m.detail}</span>
              </span>
              <span className={`num shrink-0 text-[15px] font-semibold ${m.direction === 'receive' ? 'text-income' : ''}`}>{formatMoney(m.cents, m.currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One compact line per item for the week view (no big cards for little information). */
function WeekLine({ item, today, nowTime, onOpen }: { item: AgendaItem; today: string; nowTime: string; onOpen(i: AgendaItem): void }) {
  const state = timeState(item, today, nowTime)
  const muted = state === 'done' || state === 'missed' || state === 'ended'
  return (
    <button type="button" onClick={() => onOpen(item)} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-tint/[0.03] tap">
      <span className="num w-11 shrink-0 text-[13px] text-soft">{item.start || '—'}</span>
      <span className={`size-2 shrink-0 rounded-full ${dotOf(item)} ${muted ? 'opacity-50' : ''}`} />
      <span className={`min-w-0 flex-1 truncate text-[14px] ${muted ? 'text-faint' : ''} ${state === 'done' ? 'line-through' : ''}`}>{item.title}</span>
      <span className={`shrink-0 text-[12px] ${state === 'now' ? 'font-semibold text-accent-hi' : state === 'awaiting' ? 'font-semibold text-warn' : 'text-faint'}`}>
        {state === 'now' || state === 'awaiting' || state === 'missed' ? TIME_STATE_LABEL[state] : itemLabel(item)}
      </span>
    </button>
  )
}

export function AgendaPage() {
  const { data, settings } = useStore()
  const tz = zoneOf(settings)
  const today = useToday(tz)
  const clock = useNow(30_000)
  const nowTime = nowIn(tz, clock).time
  const [view, setView] = useState<'day' | 'week'>('day')
  const [selected, setSelected] = useState<string | null>(null)
  const day = selected ?? today
  const days = weekDates(day)
  const items = useMemo(() => buildAgenda(data, settings, days[0], days[6], clock), [data, settings, days[0], clock]) // eslint-disable-line react-hooks/exhaustive-deps
  const money = useMemo(() => new Map(days.map((d) => [d, moneyDueOn(data, settings, d)])), [data, settings, days[0]]) // eslint-disable-line react-hooks/exhaustive-deps
  const newEvent = useSheet<string>()
  const editEvent = useSheet<CalendarEvent>()
  useOpenParam(data.events, editEvent.show)
  const { open, sheets } = useOpenItem()
  const pick = (d: string) => setSelected(d === today ? null : d)

  const dayItems = items.filter((i) => i.date === day)
  const dayMoney = money.get(day) ?? []
  const weekCount = items.length
  const weekMoney = [...money.values()].reduce((n, l) => n + l.length, 0)

  return (
    <>
      <PageHeader
        rich
        icon={CalendarDays}
        eyebrow={MONTH.format(at(day))}
        title="Agenda"
        subtitle="Compromissos, tarefas, rotina, hábitos e cobranças num lugar só"
        primary={{ label: 'Compromisso', aria: 'Novo compromisso', onPress: () => newEvent.show(day) }}
        stats={[
          { label: day === today ? 'Hoje' : 'Neste dia', value: dayItems.length },
          { label: 'Na semana', value: weekCount },
          { label: 'Cobranças', value: weekMoney },
        ]}
      />

      <div className="mb-3 flex items-center gap-2">
        <Segmented<'day' | 'week'> variant="underline" label="Visualização" value={view} onChange={setView} options={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }]} />
        <div className="ml-auto flex items-center gap-1">
          {day !== today && (
            <button type="button" onClick={() => setSelected(null)} className="press h-9 rounded-full px-3 text-[14px] font-medium text-accent-hi ring-1 ring-accent/30 ring-inset hover:bg-accent/[0.08]">
              Hoje
            </button>
          )}
          <IconButton label="Semana anterior" size="sm" onClick={() => pick(addDaysToDate(day, -7))}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Próxima semana" size="sm" onClick={() => pick(addDaysToDate(day, 7))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      <div className="mb-5">
        <WeekStrip days={days} selected={day} today={today} items={items} money={money} onPick={pick} />
      </div>

      {view === 'day' ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
          <section aria-label={dayTitle(day)}>
            <h2 className="mb-2 px-1 text-[15px] font-semibold tracking-[-0.01em] first-letter:uppercase">{day === today ? `Hoje, ${dayTitle(day).split(', ')[1]}` : dayTitle(day)}</h2>
            {dayItems.length ? (
              <DayTimeline items={dayItems} today={today} nowTime={nowTime} onOpen={open} />
            ) : (
              <div className="card flex items-center justify-between gap-3 px-4 py-4">
                <span className="text-[15px] text-soft">{day < today ? 'Nada registrado neste dia.' : 'Dia livre.'}</span>
                {day >= today && (
                  <button type="button" onClick={() => newEvent.show(day)} className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                    <Plus size={16} /> Compromisso
                  </button>
                )}
              </div>
            )}
          </section>
          <MoneyList list={dayMoney} />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {days.map((d) => {
            const its = items.filter((i) => i.date === d)
            const m = money.get(d) ?? []
            return (
              <section key={d} aria-label={dayTitle(d)} className={`card p-1.5 ${d === today ? 'ring-1 ring-accent/35 ring-inset' : ''}`}>
                <button type="button" onClick={() => (pick(d), setView('day'))} className="flex w-full items-center gap-2 rounded-xl px-2.5 pt-1.5 pb-1 text-left">
                  <span className={`text-[14px] font-semibold first-letter:uppercase ${d === today ? 'text-accent-hi' : ''}`}>{dayTitle(d)}</span>
                  {d === today && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-on-accent">Hoje</span>}
                  <span className="ml-auto text-[12px] text-faint">{its.length + m.length || 'Livre'}</span>
                </button>
                {its.map((i) => (
                  <WeekLine key={i.key} item={i} today={today} nowTime={nowTime} onOpen={open} />
                ))}
                {m.map((x) => (
                  <button key={x.key} type="button" onClick={() => navigate(x.path, { open: x.id })} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-tint/[0.03] tap">
                    <span className="w-11 shrink-0" />
                    <span className={`size-2 shrink-0 rounded-full ${x.direction === 'pay' ? 'bg-expense' : 'bg-income'}`} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{x.title}</span>
                    <span className="num shrink-0 text-[12px] font-semibold">{formatMoney(x.cents, x.currency)}</span>
                  </button>
                ))}
              </section>
            )
          })}
        </div>
      )}
      <EventForm open={newEvent.open} onClose={newEvent.close} event={null} initial={{ date: newEvent.item ?? today }} />
      <EventForm open={editEvent.open} onClose={editEvent.close} event={editEvent.item} />
      {sheets}
    </>
  )
}
