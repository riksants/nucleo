import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { buildAgenda, type AgendaItem } from '../../core/agenda'
import { addDaysToDate, useToday, weekDates, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { formatDateValue } from '../../lib/dates'
import { IconButton } from '../../ui/Button'
import { EmptyState, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { AgendaRow } from './AgendaRow'
import { EventForm } from './EventForm'
import { useOpenItem } from './openItem'
import { useOpenParam } from '../useOpenParam'
import type { CalendarEvent } from '../../data/types'

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayTitle = (date: string) => WEEKDAY.format(new Date(`${date}T12:00:00Z`)).replace('.', '')

function DayList({ items, onOpen }: { items: AgendaItem[]; onOpen(i: AgendaItem): void }) {
  const timed = items.filter((i) => i.start)
  const anytime = items.filter((i) => !i.start)
  if (!items.length) return <p className="card px-4 py-3.5 text-[15px] text-faint">Nada marcado.</p>
  return (
    <div className="space-y-3">
      {timed.length > 0 && (
        <div className="card p-1.5">
          {timed.map((i) => (
            <AgendaRow key={i.key} item={i} onOpen={onOpen} />
          ))}
        </div>
      )}
      {anytime.length > 0 && (
        <div className="card p-1.5">
          <p className="px-3.5 pt-2 pb-1 text-[13px] font-semibold text-faint">Sem horário</p>
          {anytime.map((i) => (
            <AgendaRow key={i.key} item={i} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AgendaPage() {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  const [view, setView] = useState<'day' | 'week'>('day')
  const [anchor, setAnchor] = useState<string | null>(null)
  const base = anchor ?? today
  const days = view === 'day' ? [base] : weekDates(base)
  const items = useMemo(() => buildAgenda(data, settings, days[0], days[days.length - 1]), [data, settings, days[0], days[days.length - 1]])
  const newEvent = useSheet<string>()
  const editEvent = useSheet<CalendarEvent>()
  useOpenParam(data.events, editEvent.show)
  const { open, sheets } = useOpenItem()
  const step = view === 'day' ? 1 : 7
  const label = view === 'day' ? (base === today ? 'Hoje' : dayTitle(base)) : `${formatDateValue(days[0])} – ${formatDateValue(days[6])}`.toLowerCase()

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Tudo o que está marcado, num lugar só"
        primary={{ label: 'Compromisso', aria: 'Novo compromisso', onPress: () => newEvent.show(base) }}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented<'day' | 'week'> variant="underline" value={view} onChange={setView} options={[{ value: 'day', label: 'Hoje' }, { value: 'week', label: 'Semana' }]} />
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Anterior" size="sm" onClick={() => setAnchor(addDaysToDate(base, -step))}>
            <ChevronLeft size={18} />
          </IconButton>
          <button type="button" onClick={() => setAnchor(null)} className="hit relative min-w-24 px-1 text-center text-[14px] font-medium first-letter:uppercase">
            {label}
          </button>
          <IconButton label="Próximo" size="sm" onClick={() => setAnchor(addDaysToDate(base, step))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      {view === 'day' ? (
        items.length ? (
          <DayList items={items} onOpen={open} />
        ) : (
          <EmptyState compact icon={<CalendarDays size={20} />} title="Dia livre" text="Compromissos, tarefas com prazo, rotina, hábitos e recorrentes aparecem aqui." action="Novo compromisso" onAction={() => newEvent.show(base)} />
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {days.map((d) => (
            <section key={d}>
              <SectionTitle>
                <span className={d === today ? 'text-accent-hi' : ''}>{dayTitle(d)}</span>
              </SectionTitle>
              <DayList items={items.filter((i) => i.date === d)} onOpen={open} />
            </section>
          ))}
        </div>
      )}
      <EventForm open={newEvent.open} onClose={newEvent.close} event={null} initial={{ date: newEvent.item ?? today }} />
      <EventForm open={editEvent.open} onClose={editEvent.close} event={editEvent.item} />
      {sheets}
    </>
  )
}
