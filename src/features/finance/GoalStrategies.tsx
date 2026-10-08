import { Briefcase, PiggyBank, Repeat, ShoppingBag } from 'lucide-react'
import type { ReactNode } from 'react'
import { goalStrategies, type StrategyPeriod } from '../../core/goalStrategies'
import type { Currency, FinanceGoal } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { formatMoney } from '../../lib/money'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const PER: Record<StrategyPeriod, string> = { month: 'por mês', week: 'por semana', total: 'até o prazo' }

function Block({ icon, title, caption, children }: { icon: ReactNode; title: string; caption?: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="flex items-center gap-2 font-sans text-[13px] font-semibold tracking-normal text-soft uppercase">
        <span aria-hidden className="text-accent-hi">
          {icon}
        </span>
        {title}
      </h3>
      {caption && <p className="mt-1 text-[13px] text-faint">{caption}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** One scenario: what you'd do on the left, the number on the right (with a small detail under it). */
function Line({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-1 last:pb-0">
      <span className="min-w-0 text-[15px] text-soft">{label}</span>
      <span className="shrink-0 text-right">
        <span className="num block text-[15px] font-semibold text-ink">{value}</span>
        {detail && <span className="num block text-[13px] text-faint">{detail}</span>}
      </span>
    </div>
  )
}

/**
 * "Como alcançar": scenarios computed from what is still missing and the time left (see core/goalStrategies).
 * Renders nothing when the goal is reached or the deadline has come.
 */
export function GoalStrategies({ goal, today }: { goal: FinanceGoal; today: string }) {
  const s = goalStrategies(Math.max(goal.target - goal.saved, 0), today, goal.deadline)
  if (!s) return null
  const money = (c: number) => formatMoney(c, goal.currency as Currency, { compact: true })
  const per = PER[s.period]
  const left = s.period === 'month' ? plural(s.periods, 'mês', 'meses') : s.period === 'week' ? plural(s.periods, 'semana', 'semanas') : plural(s.daysLeft, 'dia', 'dias')
  const saveTiles = [
    s.save.perMonth !== null && { label: 'por mês', value: s.save.perMonth },
    s.save.perWeek !== null && { label: 'por semana', value: s.save.perWeek },
    { label: 'por dia', value: s.save.perDay },
  ].filter(Boolean) as { label: string; value: number }[]

  return (
    <div className="space-y-3" data-strategies>
      <p className="text-[15px] leading-relaxed text-soft">
        Faltam <span className="num font-semibold text-ink">{money(s.missing)}</span> · {left} até {formatDateValue(goal.deadline).toLowerCase()}
      </p>

      <Block icon={<PiggyBank size={16} />} title="Guardar">
        <div className={`grid gap-3 ${saveTiles.length === 3 ? 'grid-cols-3' : saveTiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {saveTiles.map((t) => (
            <div key={t.label} className="min-w-0">
              <p className="num text-[18px] leading-tight font-semibold [overflow-wrap:anywhere]">{money(t.value)}</p>
              <p className="text-[13px] text-faint">{t.label}</p>
            </div>
          ))}
        </div>
      </Block>

      {s.sales.length > 0 && (
        <Block icon={<ShoppingBag size={16} />} title="Vendas" caption="Quantas vendas, dependendo do preço">
          {s.sales.map((x) => (
            <Line key={x.price} label={`Produto de ${money(x.price)}`} value={plural(x.total, 'venda', 'vendas')} detail={x.perPeriod !== null ? `${x.perPeriod} ${per}` : per} />
          ))}
        </Block>
      )}

      {s.recurring.length > 0 && (
        <Block icon={<Repeat size={16} />} title="Recorrência" caption={`Mensalidade paga por ${plural(s.recurringMonths, 'mês', 'meses')}, até o prazo`}>
          {s.recurring.map((x) => (
            <Line key={x.people} label={`${x.people} pessoas pagando`} value={`${money(x.fee)}/mês`} />
          ))}
        </Block>
      )}

      {s.services.length > 0 && (
        <Block icon={<Briefcase size={16} />} title="Serviços" caption="Quanto cobrar, dependendo de quantos fizer">
          {s.services.map((x) => (
            <Line key={x.count} label={`${plural(x.count, 'serviço', 'serviços')} ${per}`} value={`${money(x.price)} cada`} />
          ))}
        </Block>
      )}

      <p className="px-1 text-[13px] leading-relaxed text-faint">Valores arredondados para cima, calculados sobre o que falta. São cenários para inspirar — dá para combinar mais de um.</p>
    </div>
  )
}
