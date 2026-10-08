import { ChevronRight, Salad } from 'lucide-react'
import { navigate } from '../../app/router'
import type { FlatMetrics } from '../../core/weekSummary'
import { Progress, SectionTitle } from '../../ui/Display'

/**
 * Meals of the week: own counters (planned, marked as done, days with a plan).
 * Never part of "itens concluídos" or the Score; no nutrition score.
 */
export function MealsCard({ flat, isCurrent }: { flat: FlatMetrics; isCurrent: boolean }) {
  const planned = flat['meals.planned'] ?? 0
  if (!planned) return null
  const done = flat['meals.done'] ?? 0
  const days = flat['meals.days'] ?? 0
  const pct = Math.round((done / planned) * 100)
  return (
    <section>
      <SectionTitle>Alimentação</SectionTitle>
      <button type="button" onClick={() => navigate('/meals')} className="card block w-full p-5 text-left hover:border-line-strong">
        <span className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-income/12 text-income">
            <Salad size={20} />
          </span>
          <span className="min-w-0 flex-1 text-[15px] leading-snug">
            {done} de {planned} {planned === 1 ? 'refeição planejada marcada' : 'refeições planejadas marcadas'} como realizada{planned === 1 ? '' : 's'}{isCurrent ? ' até agora' : ''}
            <span className="block text-[13px] text-faint">
              {days} {days === 1 ? 'dia' : 'dias'} com planejamento · {pct}%
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-faint" />
        </span>
        <span className="mt-3 block">
          <Progress value={pct} tone="positive" />
        </span>
      </button>
    </section>
  )
}
