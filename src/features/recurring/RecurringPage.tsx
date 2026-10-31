import { CalendarClock, ChevronDown, ListRestart, Pause, Receipt, Repeat } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { useDailyActions } from '../../core/actions'
import { indexCompletions, statusOf } from '../../core/completions'
import { moveOccurrence, nextRecurring, recurringDue, recurringState, recurringTime } from '../../core/habits'
import { addDaysToDate, useToday, zoneOf } from '../../core/period'
import { describeRule } from '../../core/recurrence'
import { useStore } from '../../data/store'
import type { RecurringItem } from '../../data/types'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { CheckButton } from '../daily/CheckButton'
import { EmptyState, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { useOpenParam } from '../useOpenParam'
import { RecurringForm } from './RecurringForm'

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
const at = (d: string) => new Date(`${d}T12:00:00Z`)

/** A date as a small tile: day number big, weekday or month small. */
function DateTile({ date, today, tone }: { date: string; today: string; tone?: 'now' }) {
  return (
    <span className={`flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5 ${tone === 'now' ? 'bg-accent text-on-accent' : date === addDaysToDate(today, 1) ? 'bg-accent/[0.12] text-accent-hi' : 'bg-tint/[0.05] text-ink'}`}>
      <span className="num text-[18px] leading-none font-semibold">{Number(date.slice(8))}</span>
      <span className={`mt-0.5 text-[10px] font-semibold tracking-wide uppercase ${tone === 'now' ? '' : 'text-faint'}`}>{(date.slice(0, 7) === today.slice(0, 7) ? WEEKDAY : MONTH).format(at(date)).replace('.', '')}</span>
    </span>
  )
}

/** Today's occurrence: mark, skip or move to tomorrow. */
function TodayRow({ item, date, status, onOpen }: { item: RecurringItem; date: string; status: ReturnType<typeof statusOf>; onOpen(i: RecurringItem): void }) {
  const { setCompletion } = useDailyActions()
  const { save } = useStore()
  const { toast } = useFeedback()
  const postpone = async () => {
    await save('recurring', moveOccurrence(item, date, addDaysToDate(date, 1), date))
    toast(`${item.title}: movido para amanhã`)
  }
  return (
    <div className="flex items-center gap-1 rounded-2xl px-1 hover:bg-tint/[0.03] tap">
      <CheckButton status={status} onClick={() => setCompletion('recurring', item.id, date, status === 'done' ? null : 'done')} label={status === 'done' ? `Desmarcar ${item.title}` : `Concluir ${item.title}`} />
      <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 py-3 pr-1 text-left">
        <span className={`flex items-center gap-1.5 text-[15px] ${status === 'done' ? 'text-faint line-through' : status === 'skipped' ? 'text-faint' : 'font-medium'}`}>
          {item.bill && <Receipt size={14} className="shrink-0 text-accent-hi" aria-label="Conta" />}
          <span className="truncate">{item.title}</span>
        </span>
        <span className="block truncate text-[13px] text-faint">{status === 'skipped' ? 'Pulado hoje' : [recurringTime(item, date), describeRule(item.rule)].filter(Boolean).join(' · ')}</span>
      </button>
      {status === 'pending' && (
        <button type="button" onClick={postpone} className="shrink-0 rounded-xl px-2.5 py-2 text-[13px] font-medium text-soft hover:bg-tint/[0.04] tap hover:text-ink">
          Amanhã
        </button>
      )}
      {status !== 'done' && (
        <button type="button" onClick={() => setCompletion('recurring', item.id, date, status === 'skipped' ? null : 'skipped')} className="shrink-0 rounded-xl px-2.5 py-2 text-[13px] font-medium text-faint hover:bg-tint/[0.04] tap hover:text-soft">
          {status === 'skipped' ? 'Desfazer' : 'Pular'}
        </button>
      )}
    </div>
  )
}

export function RecurringPage() {
  const { data, settings, save } = useStore()
  const { toast } = useFeedback()
  const form = useSheet<RecurringItem>()
  useOpenParam(data.recurring, form.show)
  const today = useToday(zoneOf(settings))
  const index = useMemo(() => indexCompletions(data.completions), [data.completions])
  const [showAll, setShowAll] = useState(false)
  const [showStopped, setShowStopped] = useState(false)
  const due = recurringDue(data.recurring, today)
  const tomorrow = addDaysToDate(today, 1)
  const upcoming = data.recurring
    .filter((r) => recurringState(r, today) === 'active')
    .map((r) => ({ item: r, next: nextRecurring(r, tomorrow) }))
    .filter((x): x is { item: RecurringItem; next: string } => Boolean(x.next))
    .sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : a.item.title.localeCompare(b.item.title)))
  // Paused (comes back when resumed) and ended (past its last day): out of the way, never deleted.
  const inactive = data.recurring.filter((r) => recurringState(r, today) !== 'active').sort((a, b) => a.title.localeCompare(b.title))
  const week = upcoming.filter((u) => u.next <= addDaysToDate(today, 7)).length
  const bills = data.recurring.filter((r) => recurringState(r, today) === 'active' && r.bill).length
  const nextOne = upcoming[0]
  const rest = upcoming.slice(1)
  const shown = showAll ? rest : rest.slice(0, 8)

  const postponeNext = async (item: RecurringItem, from: string) => {
    await save('recurring', moveOccurrence(item, from, addDaysToDate(from, 1), today))
    toast(`Adiado para ${formatDateValue(addDaysToDate(from, 1))}`)
  }

  return (
    <>
      <PageHeader
        rich
        icon={ListRestart}
        eyebrow="Coisas que voltam sempre"
        title="Recorrentes"
        primary={{ label: 'Novo', aria: 'Novo recorrente', onPress: () => form.show() }}
        stats={
          data.recurring.length
            ? [
                { label: 'Hoje', value: due.length },
                { label: 'Próximos 7 dias', value: week },
                { label: 'Contas', value: bills },
              ]
            : undefined
        }
      />
      {data.recurring.length === 0 ? (
        <EmptyState
          icon={<ListRestart size={20} />}
          title="Nenhum item recorrente"
          text="“Pagar aluguel todo dia 5”, “lavar roupa toda terça”… O Núcleo coloca no seu dia, na Agenda e lembra sozinho."
          action="Criar item"
          onAction={() => form.show()}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-7 lg:grid-cols-2 lg:items-start">
          <div className="space-y-7">
            <section>
              <SectionTitle>Hoje</SectionTitle>
              {due.length ? (
                <div className="card p-1.5">
                  {due.map((r) => (
                    <TodayRow key={r.id} item={r} date={today} status={statusOf(index, 'recurring', r.id, today)} onOpen={form.show} />
                  ))}
                </div>
              ) : (
                <p className="card px-5 py-4 text-[15px] text-faint">Nada recorrente para hoje.</p>
              )}
            </section>
            {nextOne && (
              <section aria-label="Próxima ocorrência">
                <SectionTitle>A seguir</SectionTitle>
                <div className="card relative overflow-hidden p-4 pl-5">
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />
                  <div className="flex items-center gap-3">
                    <DateTile date={nextOne.next} today={today} tone="now" />
                    <button type="button" onClick={() => form.show(nextOne.item)} className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-1.5 text-[17px] font-semibold tracking-[-0.02em]">
                        {nextOne.item.bill && <Receipt size={16} className="shrink-0 text-accent-hi" />}
                        <span className="truncate">{nextOne.item.title}</span>
                      </span>
                      <span className="block text-[13px] text-soft first-letter:uppercase">
                        {relativeDays(nextOne.next)?.label} · {[recurringTime(nextOne.item, nextOne.next), describeRule(nextOne.item.rule)].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => postponeNext(nextOne.item, nextOne.next)} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                      <CalendarClock size={16} /> Adiar 1 dia
                    </button>
                    <button type="button" onClick={() => form.show(nextOne.item)} className="press inline-flex h-9 items-center rounded-full px-3.5 text-[14px] font-medium text-soft hover:text-ink">
                      Editar
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
          <section>
            <SectionTitle>Próximos</SectionTitle>
            {rest.length ? (
              <div className="card divide-y divide-line">
                {shown.map(({ item, next }) => (
                  <button key={item.id} type="button" onClick={() => form.show(item)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-tint/[0.03] tap">
                    <DateTile date={next} today={today} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[15px] font-medium">
                        {item.bill && <Receipt size={14} className="shrink-0 text-accent-hi" />}
                        <span className="truncate">{item.title}</span>
                      </span>
                      <span className="flex items-center gap-1 truncate text-[12px] text-faint">
                        <Repeat size={14} className="shrink-0" />
                        {[describeRule(item.rule), recurringTime(item, next)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-soft">{relativeDays(next)?.label}</span>
                  </button>
                ))}
                {rest.length > 8 && !showAll && (
                  <button type="button" onClick={() => setShowAll(true)} className="w-full px-4 py-3 text-left text-[14px] font-medium text-accent-hi">
                    Ver mais {rest.length - 8}
                  </button>
                )}
              </div>
            ) : (
              <p className="card px-5 py-4 text-[15px] text-faint">Nada mais programado.</p>
            )}
            {inactive.length > 0 && (
              <div className="mt-6">
                <button type="button" aria-expanded={showStopped} onClick={() => setShowStopped(!showStopped)} className="flex w-full items-center gap-2 px-1 text-[13px] font-semibold text-soft hover:text-ink">
                  Pausados e encerrados · {inactive.length}
                  <ChevronDown size={16} className={`transition-transform duration-200 ${showStopped ? 'rotate-180' : ''}`} />
                </button>
                {showStopped && (
                  <div className="card mt-2 divide-y divide-line">
                    {inactive.map((r) => {
                      const st = recurringState(r, today)
                      return (
                        <button key={r.id} type="button" onClick={() => form.show(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-tint/[0.03] tap">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] text-soft">{r.title}</span>
                            <span className="block truncate text-[12px] text-faint">{describeRule(r.rule)}</span>
                          </span>
                          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${st === 'paused' ? 'bg-warn/[0.14] text-warn' : 'bg-tint/[0.06] text-faint'}`}>
                            {st === 'paused' && <Pause size={14} />}
                            {st === 'paused' ? 'Pausado' : 'Encerrado'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      <RecurringForm open={form.open} onClose={form.close} item={form.item} />
    </>
  )
}
