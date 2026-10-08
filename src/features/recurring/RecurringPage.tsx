import { ListRestart } from 'lucide-react'
import { useMemo } from 'react'
import { PageHeader } from '../../app/Shell'
import { indexCompletions, statusOf } from '../../core/completions'
import { recurringDue } from '../../core/habits'
import { addDaysToDate, useToday, zoneOf } from '../../core/period'
import { describeRule, nextOccurrence } from '../../core/recurrence'
import { useStore } from '../../data/store'
import type { RecurringItem } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { EmptyState, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { useOpenParam } from '../useOpenParam'
import { RecurringForm } from './RecurringForm'
import { RecurringRow } from './RecurringRow'

export function RecurringPage() {
  const { data, settings } = useStore()
  const form = useSheet<RecurringItem>()
  useOpenParam(data.recurring, form.show)
  const today = useToday(zoneOf(settings))
  const index = useMemo(() => indexCompletions(data.completions), [data.completions])
  const due = recurringDue(data.recurring, today)
  const tomorrow = addDaysToDate(today, 1)
  const upcoming = data.recurring
    .filter((r) => r.active)
    .map((r) => ({ item: r, next: nextOccurrence(r.rule, r.startDate, tomorrow) }))
    .filter((x): x is { item: RecurringItem; next: string } => Boolean(x.next))
    .sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : a.item.title.localeCompare(b.item.title)))
  const inactive = data.recurring.filter((r) => !r.active)

  return (
    <>
      <PageHeader
        title="Recorrentes"
        subtitle="Coisas que voltam sempre"
        primary={{ label: 'Novo', aria: 'Novo recorrente', onPress: () => form.show() }}
      />
      {data.recurring.length === 0 ? (
        <EmptyState icon={<ListRestart size={20} />} title="Nenhum item recorrente" text="Ex.: pagar aluguel todo dia 5, lavar roupa toda terça, revisar finanças aos domingos." action="Criar item" onAction={() => form.show()} />
      ) : (
        <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
          <section>
            <SectionTitle>Hoje</SectionTitle>
            {due.length ? (
              <div className="card p-1.5">
                {due.map((r) => (
                  <RecurringRow key={r.id} item={r} date={today} status={statusOf(index, 'recurring', r.id, today)} onOpen={form.show} />
                ))}
              </div>
            ) : (
              <p className="card px-5 py-4 text-[15px] text-faint">Nada recorrente para hoje.</p>
            )}
          </section>
          <section>
            <SectionTitle>Próximos</SectionTitle>
            <div className="card divide-y divide-line">
              {upcoming.map(({ item, next }) => (
                <button key={item.id} type="button" onClick={() => form.show(item)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-tint/[0.03] tap">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{item.title}</span>
                    <span className="block truncate text-[13px] text-faint">{[describeRule(item.rule), item.time].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 text-[13px] text-soft">{formatDateValue(next)}</span>
                </button>
              ))}
            </div>
            {inactive.length > 0 && (
              <>
                <h3 className="mt-6 mb-2 px-1 text-[13px] font-semibold text-soft">Desativados</h3>
                <div className="card divide-y divide-line">
                  {inactive.map((r) => (
                    <button key={r.id} type="button" onClick={() => form.show(r)} className="flex w-full items-center px-4 py-3 text-left text-[15px] text-faint hover:bg-tint/[0.03] tap">
                      {r.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      <RecurringForm open={form.open} onClose={form.close} item={form.item} />
    </>
  )
}
